// routes/api.js
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const fs = require('fs');
const fse = require('fs-extra');
const os = require('os');
const path = require('path');

let currentOperationProcess = null;
let cancelFlag = false;

let operationProgress = {
    id: null,
    status: 'idle', // idle, preparing, running, completed, error, cancelled
    percentage: 0,
    currentFile: 'Inactivo', // Valor por defecto más claro
    eta: '',
    message: '',
    filesCopied: 0,
    totalFiles: 0,
    totalSizeGB: 0,   // NUEVO: Tamaño total del origen en GB
    transferredGB: 0, // NUEVO: Tamaño transferido hasta ahora en GB
};

// Función auxiliar para parsear tamaños legibles por humanos (ej. 6.00M, 1.23G) a GB
function parseHumanReadableSizeToGB(sizeStr) {
    if (!sizeStr) return 0;
    const sanitizedSizeStr = String(sizeStr).replace(',', '.');
    const sizeMatch = sanitizedSizeStr.match(/(\d+\.?\d*)\s*([TGMK]?B?)/i); // Permite espacio opcional antes de la unidad
    if (sizeMatch) {
        let val = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2] ? sizeMatch[2].toUpperCase().replace('B', '') : '';
        if (unit === 'T') return val * 1024;
        if (unit === 'G') return val;
        if (unit === 'M') return val / 1024;
        if (unit === 'K') return val / (1024 * 1024);
        // Si no hay unidad o es solo bytes, asumimos bytes y convertimos a GB
        return val / (1024 * 1024 * 1024);
    }
    return 0;
}

// --- Detección de Dispositivos ---
async function getUsbDevices() {
    const currentUser = os.userInfo().username;
    const COMMON_MOUNT_POINTS = ["/media/", "/mnt/", "/run/media/"];
    const USB_MOUNT_PREFIXES = COMMON_MOUNT_POINTS.flatMap(p => [
        path.join(p, currentUser) + path.sep,
        p
    ]);

    return new Promise((resolve, reject) => {
        const lsblk = spawn('lsblk', ['-Jfpno', 'NAME,MOUNTPOINT,LABEL,SIZE,FSUSED,FSAVAIL,FSTYPE,TYPE,PKNAME,VENDOR,MODEL,PATH']);
        let output = '';
        let errorOutput = '';

        lsblk.stdout.on('data', (data) => { output += data; });
        lsblk.stderr.on('data', (data) => { errorOutput += data; });

        lsblk.on('close', (code) => {
            if (output.trim() === '') {
                console.error(`[BACKEND getUsbDevices] Salida de lsblk vacía. Código: ${code}, Error: ${errorOutput}`);
                resolve([]);
                return;
            }

            try {
                const jsonData = JSON.parse(output);

                let devicesToProcess = [];
                if (jsonData && jsonData.blockdevices) {
                    jsonData.blockdevices.forEach(disk => {
                        if (disk.children && disk.children.length > 0) {
                            disk.children.forEach(partition => {
                                devicesToProcess.push(partition);
                            });
                        } else {
                            devicesToProcess.push(disk);
                        }
                    });
                } else {
                     console.error("[BACKEND getUsbDevices] jsonData.blockdevices no encontrado en la salida de lsblk.");
                     resolve([]);
                     return;
                }

                const filteredDevices = devicesToProcess
                    .filter(d => {
                        const condIsMounted = d.mountpoint && USB_MOUNT_PREFIXES.some(prefix => d.mountpoint.startsWith(prefix));
                        const condIsValidType = d.type && (d.type.toLowerCase() === 'part' || (d.type.toLowerCase() === 'disk' && condIsMounted) );

                        let condIsNotSystem = true;
                        if (d.fstype === 'swap' || d.fstype === 'squashfs') condIsNotSystem = false;
                        if (d.mountpoint && (d.mountpoint === '/' || d.mountpoint.startsWith('/boot'))) condIsNotSystem = false;
                        if (d.path && d.path.startsWith('/dev/mmcblk0')) condIsNotSystem = false;

                        return condIsMounted && condIsValidType && condIsNotSystem;
                    })
                    .map(d => {
                        // Reutilizar la función parseHumanReadableSizeToGB para la info del dispositivo
                        const totalGB = parseHumanReadableSizeToGB(d.size);
                        const freeGB = parseHumanReadableSizeToGB(d.fsavail);

                        let vendor = d.vendor || '';
                        let model = d.model || '';
                        if (d.pkname && jsonData.blockdevices) {
                            const parentDisk = jsonData.blockdevices.find(disk => disk.name === d.pkname);
                            if (parentDisk) {
                                if (!vendor && parentDisk.vendor) vendor = parentDisk.vendor;
                                if (!model && parentDisk.model) model = parentDisk.model;
                            }
                        }
                        return {
                            path: d.mountpoint,
                            label: d.label || path.basename(d.mountpoint) || d.name,
                            total_space_gb: totalGB,
                            free_space_gb: freeGB,
                            device: d.name,
                            vendor: vendor.trim(),
                            model: model.trim()
                        };
                    });

                resolve(filteredDevices);

            } catch (e) {
                console.error("[BACKEND getUsbDevices] Error parseando salida de lsblk:", e.message);
                console.error("[BACKEND getUsbDevices] Salida de lsblk que causó el error (primeros 500 chars):", output.substring(0, 500) + "...");
                if (errorOutput) console.error("[BACKEND getUsbDevices] Salida de error de lsblk:", errorOutput);
                resolve([]);
            }
        });
        lsblk.on('error', (err) => {
            console.error("[BACKEND getUsbDevices] Error al ejecutar el comando lsblk:", err);
            resolve([]);
        });
    });
}

router.get('/devices', async (req, res) => {
    try {
        const devices = await getUsbDevices();
        res.json(devices);
    } catch (error) {
        console.error("Error en GET /devices:", error);
        res.status(500).json({ error: 'Error al obtener dispositivos' });
    }
});

// --- Operaciones de Copia y Sincronización ---
router.post('/start-operation', async (req, res) => {
    const { sourcePath, destinationPath, operationMode, copyDate, cameraMake } = req.body;

    if (currentOperationProcess) {
        return res.status(400).json({ error: 'Ya hay una operación en curso.' });
    }
    if (!sourcePath || !destinationPath || !operationMode) {
        return res.status(400).json({ error: 'Faltan parámetros requeridos (origen, destino, modo).' });
    }
    if (!(await fse.pathExists(sourcePath)) || !(await fse.pathExists(destinationPath))) {
        console.error(`[BACKEND start-operation] Error: Origen (${sourcePath} existe: ${await fse.pathExists(sourcePath)}) o Destino (${destinationPath} existe: ${await fse.pathExists(destinationPath)}) no válidos.`);
        return res.status(400).json({ error: 'Ruta de origen o destino no encontrada o no accesible.' });
    }

    cancelFlag = false;
    const operationId = Date.now().toString();
    operationProgress = {
        id: operationId,
        status: 'preparing',
        percentage: 0,
        currentFile: 'Preparando...', // Mensaje inicial
        eta: '',
        message: `Preparando ${operationMode === 'copy' ? 'copia' : 'sincronización'}...`,
        filesCopied: 0,
        totalFiles: 0,
        totalSizeGB: 0,   // Resetear a 0
        transferredGB: 0, // Resetear a 0
    };

    let finalDestinationPath = destinationPath;

    if (operationMode === 'copy') {
        const makeForFolder = (cameraMake || "COPIA_SD").replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toUpperCase();

        if (!copyDate) {
            operationProgress.status = 'error';
            operationProgress.message = 'Falta la fecha para la copia.';
            return res.status(400).json({ error: operationProgress.message });
        }
        try {
            const dateStr = new Date(copyDate).toISOString().slice(0, 10).replace(/-/g, "");
            const baseFolderName = `${makeForFolder}`;
            const datePath = path.join(destinationPath, dateStr);
            await fse.ensureDir(datePath);

            let counter = 1;
            let subFolder;
            do {
                subFolder = `${baseFolderName}_${String(counter).padStart(5, '0')}`;
                finalDestinationPath = path.join(datePath, subFolder);
                counter++;
            } while (await fse.pathExists(finalDestinationPath) && counter < 100000);

            if (await fse.pathExists(finalDestinationPath)) {
                throw new Error('Demasiadas carpetas con el mismo nombre base.');
            }
            await fse.ensureDir(finalDestinationPath);
            console.log("[BACKEND start-operation] Carpeta de destino para copia SD:", finalDestinationPath);
        } catch (e) {
            console.error("[BACKEND start-operation] Error creando estructura de carpetas para copia SD:", e);
            operationProgress.status = 'error';
            operationProgress.message = `Error creando estructura de carpetas: ${e.message}`;
            return res.status(500).json({ error: operationProgress.message });
        }
    } else {
         console.log("[BACKEND start-operation] Destino para sincronización:", finalDestinationPath);
    }

    const rsyncArgs = ['-ah', '--info=progress2,misc0,flist0,stats0'];
    if (operationMode === 'sync') {
        rsyncArgs.push('--ignore-existing');
    }
    const rsyncSource = sourcePath.endsWith(path.sep) ? sourcePath : sourcePath + path.sep;
    rsyncArgs.push(rsyncSource, finalDestinationPath);

    // NUEVO: Calcular tamaño total del origen con 'du -sh'
    try {
        operationProgress.message = 'Calculando tamaño del origen...'; // Mensaje intermedio
        const duProcess = spawn('du', ['-sh', rsyncSource]); // Usar la ruta de origen para rsync
        let duOutput = '';
        duProcess.stdout.on('data', (data) => { duOutput += data; });
        duProcess.stderr.on('data', (data) => { console.error(`[BACKEND du] Error stderr: ${data}`); }); // Log de errores de du

        await new Promise(resolve => duProcess.on('close', resolve)); // Esperar a que 'du' termine

        const duMatch = duOutput.trim().match(/^(\S+)\s/);
        if (duMatch) {
            operationProgress.totalSizeGB = parseHumanReadableSizeToGB(duMatch[1]);
            console.log(`[BACKEND start-operation] Tamaño total del origen: ${duMatch[1]} (${operationProgress.totalSizeGB.toFixed(2)} GB)`);
        } else {
            console.warn(`[BACKEND start-operation] No se pudo parsear el tamaño total del origen de 'du -sh'. Salida: ${duOutput.trim()}`);
        }
    } catch (e) {
        console.error(`[BACKEND start-operation] Error al ejecutar 'du -sh' para ${rsyncSource}:`, e);
        operationProgress.message = `Error al calcular tamaño del origen: ${e.message}`;
        // Continuar con rsync, pero el totalSizeGB será 0
    }


    console.log("[BACKEND start-operation] Ejecutando rsync con:", ['rsync', ...rsyncArgs].join(' '));
    operationProgress.status = 'running';
    operationProgress.message = 'Operación en curso...';
    currentOperationProcess = spawn('rsync', rsyncArgs);

    currentOperationProcess.stdout.on('data', (data) => {
        if (cancelFlag) {
            if (currentOperationProcess && !currentOperationProcess.killed) {
                currentOperationProcess.kill('SIGTERM');
            }
            return;
        }
        const lines = data.toString().split('\r');
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            // console.log("RSYNC_LINE:", line); // Para depurar el output de rsync

            // Cambiar si no funciona la barra de progreso
            // const progressMatch = line.match(/^(\S+)\s+(\d+)%\s+([\d.]+[KMGT]?B?\/s)\s+(\d{1,2}:\d{2}:\d{2})\s+\(xfr#(\d+)/);
            const progressMatch = line.match(/^(\S+)\s+(\d+)%\s+([\d.,]+[KMGT]?B?\/s)\s+(\d{1,2}:\d{2}:\d{2})\s+\(xfr#(\d+)/);

            if (progressMatch) {
                operationProgress.percentage = parseInt(progressMatch[2]);
                operationProgress.eta = progressMatch[4];
                // NUEVO: Actualizar gigabytes transferidos
                operationProgress.transferredGB = parseHumanReadableSizeToGB(progressMatch[1]);
            }
            // Mantenemos currentFile como un mensaje genérico, ya que rsync progress2 no lo muestra por archivo.
            operationProgress.currentFile = 'Procesando archivos...';
        });
    });

    currentOperationProcess.stderr.on('data', (data) => {
        const errorMsg = data.toString().trim();
        if (errorMsg) {
            console.warn(`[BACKEND start-operation] rsync stderr: ${errorMsg}`);
            if (operationProgress.message && !operationProgress.message.includes("Advertencia rsync")) {
                operationProgress.message += ` (Advertencia rsync: ${errorMsg.substring(0, 100)})`;
            }
        }
    });

    currentOperationProcess.on('close', (code) => {
        console.log("[BACKEND start-operation] Proceso rsync finalizado con código:", code);
        if (cancelFlag) {
            operationProgress.status = 'cancelled';
            operationProgress.message = `${operationMode === 'copy' ? 'Copia' : 'Sincronización'} cancelada.`;
            operationProgress.currentFile = 'Cancelado';
        } else if (code === 0 || code === 24) {
            operationProgress.status = 'completed';
            operationProgress.percentage = 100;
            operationProgress.currentFile = 'Completado';
            operationProgress.message = `${operationMode === 'copy' ? 'Copia' : 'Sincronización'} completada.`;
            // Asegurar que gigas copiados y porcentaje sean finales
            if (operationProgress.totalSizeGB > 0) { // Si pudimos calcular el total
                operationProgress.transferredGB = operationProgress.totalSizeGB;
            } else { // Si no, o si el source cambió de tamaño
                 // Si rsync reporta el tamaño final de alguna manera, se podría usar.
                 // Por ahora, asumimos que el último transferredGB es el total si totalSizeGB no se pudo obtener.
                 // O simplemente lo dejamos como está.
            }

            if (code === 24) operationProgress.message += " (con algunas advertencias, revisar logs rsync)";
        } else {
            operationProgress.status = 'error';
            operationProgress.message = `${operationMode === 'copy' ? 'Copia' : 'Sincronización'} falló. Código rsync: ${code}.`;
            operationProgress.currentFile = 'Error';
        }
        currentOperationProcess = null;
        cancelFlag = false;
        operationProgress.id = null; // Limpiar el ID de operación para futuras requests
        console.log("[BACKEND start-operation] Estado final de la operación:", operationProgress.message);
    });

    currentOperationProcess.on('error', (err) => {
        console.error("[BACKEND start-operation] Error al iniciar rsync:", err);
        operationProgress.status = 'error';
        operationProgress.message = `Error al iniciar rsync: ${err.message}`;
        operationProgress.currentFile = 'Error';
        currentOperationProcess = null;
        cancelFlag = false;
        operationProgress.id = null;
    });

    res.json({ message: 'Operación iniciada', operationId: operationProgress.id });
});

// --- Progreso y Cancelación ---
router.get('/progress/:operationId', (req, res) => {
    // Si la operación ha finalizado y operationProgress.id se ha limpiado, el ID no coincidirá
    if (req.params.operationId === operationProgress.id) {
        res.json(operationProgress);
    } else {
        // Enviar el estado final si el ID no coincide pero el status no es 'idle'
        // Esto es útil si el frontend hace un último poll y la operación acaba justo antes
        if (operationProgress.status !== 'idle' && operationProgress.id === null) {
             res.json({
                ...operationProgress,
                id: req.params.operationId, // Devolver el ID solicitado para que el frontend lo reconozca
                message: 'Operación finalizada o no encontrada. Por favor, inicie una nueva.'
             });
        } else {
            res.status(404).json({
                id: req.params.operationId,
                status: 'unknown',
                message: 'ID de operación no encontrado o ya finalizado.'
            });
        }
    }
});

router.post('/cancel/:operationId', (req, res) => {
    if (req.params.operationId === operationProgress.id && currentOperationProcess) {
        console.log("[BACKEND cancel] Solicitud de cancelación recibida para la operación:", operationProgress.id);
        cancelFlag = true;
        if (currentOperationProcess && !currentOperationProcess.killed) {
            currentOperationProcess.kill('SIGTERM');
            setTimeout(() => {
                if (currentOperationProcess && !currentOperationProcess.killed) {
                    console.warn("[BACKEND cancel] rsync no terminó con SIGTERM, enviando SIGKILL");
                    currentOperationProcess.kill('SIGKILL');
                }
            }, 2000);
        }
        operationProgress.status = 'cancelling';
        operationProgress.message = 'Cancelando operación...';
        res.json({ message: 'Solicitud de cancelación enviada.' });
    } else {
        res.status(400).json({ error: 'No hay operación en curso para cancelar o ID incorrecto.' });
    }
});

// --- Rutas para Control del Sistema ---
const executeSystemCommand = (command, args, res, actionName) => {
    console.log(`[BACKEND system] Ejecutando comando de sistema: ${command} ${args.join(' ')}`);
    try {
        const proc = spawn(command, args);
        proc.on('close', (code) => {
            if (code === 0) {
                res.json({ message: `${actionName} iniciado.` });
            } else {
                console.error(`[BACKEND system] Error al ejecutar ${command} ${args.join(' ')}, código: ${code}`);
                res.status(500).json({ error: `Error al ejecutar ${actionName}` });
            }
        });
        proc.on('error', (err) => {
            console.error(`[BACKEND system] Error al INICIAR ${command} ${args.join(' ')}: ${err.message}`);
            res.status(500).json({ error: `Error al iniciar ${actionName}: ${err.message}. ¿Está '${command}' en el PATH y tiene permisos sudo configurados?` });
        });
    } catch(e) {
         console.error(`[BACKEND system] EXCEPCIÓN al intentar spawn ${command}: ${e.message}`);
         res.status(500).json({ error: `Excepción al intentar ${actionName}: ${e.message}` });
    }
};

router.post('/reboot', (req, res) => executeSystemCommand('sudo', ['reboot'], res, 'Reinicio'));
router.post('/shutdown', (req, res) => executeSystemCommand('sudo', ['shutdown', '-h', 'now'], res, 'Apagado'));

module.exports = router;
