// routes/api.js
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process'); // Ya no necesitamos execFile aquí
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
    currentFile: '',
    eta: '',
    message: '',
    filesCopied: 0,
    totalFiles: 0,
};

// --- Detección de Dispositivos ---
async function getUsbDevices() {
    const currentUser = os.userInfo().username;
    const COMMON_MOUNT_POINTS = ["/media/", "/mnt/", "/run/media/"];
    const USB_MOUNT_PREFIXES = COMMON_MOUNT_POINTS.flatMap(p => [
        path.join(p, currentUser) + path.sep,
        p
    ]);

    // console.log("[BACKEND getUsbDevices] Buscando dispositivos USB con prefijos:", USB_MOUNT_PREFIXES); // Comentado para logs más limpios

    return new Promise((resolve, reject) => {
        const lsblk = spawn('lsblk', ['-Jfpno', 'NAME,MOUNTPOINT,LABEL,SIZE,FSUSED,FSAVAIL,FSTYPE,TYPE,PKNAME,VENDOR,MODEL,PATH']);
        let output = '';
        let errorOutput = '';

        lsblk.stdout.on('data', (data) => { output += data; });
        lsblk.stderr.on('data', (data) => { errorOutput += data; });

        lsblk.on('close', (code) => {
            // console.log(`[BACKEND getUsbDevices] lsblk cerró con código: ${code}`); // Comentado
            if (output.trim() === '') {
                console.error(`[BACKEND getUsbDevices] Salida de lsblk vacía. Código: ${code}, Error: ${errorOutput}`);
                resolve([]);
                return;
            }

            try {
                const jsonData = JSON.parse(output);
                // console.log("[BACKEND getUsbDevices] Raw lsblk JSON:", JSON.stringify(jsonData, null, 2)); // Comentado

                let devicesToProcess = [];
                if (jsonData && jsonData.blockdevices) {
                    jsonData.blockdevices.forEach(disk => {
                        if (disk.children && disk.children.length > 0) {
                            disk.children.forEach(partition => {
                                devicesToProcess.push(partition);
                            });
                        } else { // Si no tiene hijos, considerar el disco mismo
                            devicesToProcess.push(disk);
                        }
                    });
                } else {
                     console.error("[BACKEND getUsbDevices] jsonData.blockdevices no encontrado en la salida de lsblk.");
                     resolve([]); // Devolver array vacío si no hay blockdevices
                     return;
                }
                
                // console.log(`[BACKEND getUsbDevices] Total de dispositivos/particiones a procesar: ${devicesToProcess.length}`); // Comentado

                const filteredDevices = devicesToProcess
                    .filter(d => {
                        const condIsMounted = d.mountpoint && USB_MOUNT_PREFIXES.some(prefix => d.mountpoint.startsWith(prefix));
                        const condIsValidType = d.type && (d.type.toLowerCase() === 'part' || (d.type.toLowerCase() === 'disk' && condIsMounted) );
                        
                        let condIsNotSystem = true;
                        if (d.fstype === 'swap' || d.fstype === 'squashfs') condIsNotSystem = false;
                        if (d.mountpoint && (d.mountpoint === '/' || d.mountpoint.startsWith('/boot'))) condIsNotSystem = false;
                        if (d.path && d.path.startsWith('/dev/mmcblk0')) condIsNotSystem = false; // Excluir SD de la RPi explícitamente
                        
                        // console.log(`[BACKEND getUsbDevices] Chequeando: ${d.name}. MontadoOK: ${condIsMounted}, TipoOK: ${condIsValidType}, NoSistemaOK: ${condIsNotSystem}`); // Comentado
                        
                        return condIsMounted && condIsValidType && condIsNotSystem;
                    })
                    .map(d => {
                        const parseSize = (sizeStr) => {
                            if (!sizeStr) return 0;
                            const sanitizedSizeStr = String(sizeStr).replace(',', '.');
                            const sizeMatch = sanitizedSizeStr.match(/(\d+\.?\d*)([TGMK]?B?)/i);
                            if (sizeMatch) {
                                let val = parseFloat(sizeMatch[1]);
                                const unit = sizeMatch[2] ? sizeMatch[2].toUpperCase().replace('B', '') : '';
                                if (unit === 'T') return val * 1024;
                                if (unit === 'G') return val;
                                if (unit === 'M') return val / 1024;
                                if (unit === 'K') return val / (1024 * 1024);
                                return val / (1024 * 1024 * 1024); // Asumir bytes si no hay unidad
                            }
                            return 0;
                        };
                        // Intentar obtener vendor/model del disco padre si la partición no los tiene
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
                            total_space_gb: parseSize(d.size),
                            free_space_gb: parseSize(d.fsavail),
                            device: d.name,
                            vendor: vendor.trim(), // Quitar espacios extra de vendor/model
                            model: model.trim()
                        };
                    });

                // console.log("[BACKEND getUsbDevices] Dispositivos USB filtrados:", filteredDevices.length); // Comentado
                // filteredDevices.forEach(d => console.log(`  [BACKEND getUsbDevices] - Filtrado Aceptado: ${d.label}`)); // Comentado
                
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

// RUTA /api/get-camera-info HA SIDO ELIMINADA

// --- Operaciones de Copia y Sincronización ---
router.post('/start-operation', async (req, res) => {
    // cameraModel ya no se recibe ni se usa para la lógica de carpetas.
    // cameraMake es el único campo de texto que el usuario provee para el nombre de la carpeta de copia SD.
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
        currentFile: 'Preparando...',
        eta: '',
        message: `Preparando ${operationMode === 'copy' ? 'copia' : 'sincronización'}...`,
        filesCopied: 0,
        totalFiles: 0,
    };

    let finalDestinationPath = destinationPath;

    if (operationMode === 'copy') {
        // Usar cameraMake (Nombre para la Carpeta) proporcionado por el usuario.
        // Saneamiento y valor por defecto si está vacío.
        const makeForFolder = (cameraMake || "COPIA_SD").replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toUpperCase();

        if (!copyDate) {
            operationProgress.status = 'error';
            operationProgress.message = 'Falta la fecha para la copia.';
            return res.status(400).json({ error: operationProgress.message });
        }
        try {
            const dateStr = new Date(copyDate).toISOString().slice(0, 10).replace(/-/g, "");
            // baseFolderName ahora solo usa makeForFolder.
            const baseFolderName = `${makeForFolder}`;
            const datePath = path.join(destinationPath, dateStr);
            await fse.ensureDir(datePath); // Crea el directorio de fecha si no existe

            let counter = 1;
            let subFolder;
            do {
                // El contador se añade directamente al nombre base.
                subFolder = `${baseFolderName}_${String(counter).padStart(5, '0')}`;
                finalDestinationPath = path.join(datePath, subFolder);
                counter++;
            } while (await fse.pathExists(finalDestinationPath) && counter < 100000);

            if (await fse.pathExists(finalDestinationPath)) { // Muy improbable llegar aquí si el contador es alto
                throw new Error('Demasiadas carpetas con el mismo nombre base.');
            }
            await fse.ensureDir(finalDestinationPath); // Crea la subcarpeta final
            console.log("[BACKEND start-operation] Carpeta de destino para copia SD:", finalDestinationPath);
        } catch (e) {
            console.error("[BACKEND start-operation] Error creando estructura de carpetas para copia SD:", e);
            operationProgress.status = 'error';
            operationProgress.message = `Error creando estructura de carpetas: ${e.message}`;
            return res.status(500).json({ error: operationProgress.message });
        }
    } else { // operationMode === 'sync'
         console.log("[BACKEND start-operation] Destino para sincronización:", finalDestinationPath);
    }

    const rsyncArgs = ['-ah', '--info=progress2,misc0,flist0,stats0'];
    if (operationMode === 'sync') {
        rsyncArgs.push('--ignore-existing'); // Copia solo si el archivo/directorio NO existe en destino
    }
    // Asegurar que sourcePath termine con '/' para copiar contenido de la carpeta, no la carpeta misma.
    const rsyncSource = sourcePath.endsWith(path.sep) ? sourcePath : sourcePath + path.sep;
    rsyncArgs.push(rsyncSource, finalDestinationPath);

    console.log("[BACKEND start-operation] Ejecutando rsync con:", ['rsync', ...rsyncArgs].join(' '));
    operationProgress.status = 'running';
    operationProgress.message = 'Operación en curso...';
    currentOperationProcess = spawn('rsync', rsyncArgs);

    currentOperationProcess.stdout.on('data', (data) => {
        if (cancelFlag) { // Verificar si se debe cancelar
            if (currentOperationProcess && !currentOperationProcess.killed) {
                currentOperationProcess.kill('SIGTERM'); // Enviar señal para terminar
            }
            return;
        }
        const lines = data.toString().split('\r'); // rsync usa \r para sobrescribir líneas de progreso
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            // console.log("RSYNC_LINE:", line); // Para depurar el output de rsync
            const progressMatch = line.match(/([\d,]+)\s+(\d+)%\s+([\d.]+[KMGT]?B?\/s)\s+(\d+:\d+:\d+)\s+\(xfr#(\d+)/);

            if (progressMatch) {
                operationProgress.percentage = parseInt(progressMatch[2]);
                operationProgress.eta = progressMatch[4];
            } else if (!line.includes('%') && line.length > 3 && !line.startsWith('sending incremental') && !line.startsWith('total size is') && !line.startsWith('sent ') && !line.startsWith('delta-transmission')) {
                // Si no es una línea de progreso y parece un path, tomarlo como archivo actual
                operationProgress.currentFile = path.basename(line);
            }
        });
    });

    currentOperationProcess.stderr.on('data', (data) => {
        const errorMsg = data.toString().trim();
        if (errorMsg) {
            console.warn(`[BACKEND start-operation] rsync stderr: ${errorMsg}`);
            if (operationProgress.message && !operationProgress.message.includes("Advertencia rsync")) { // Evitar mensajes duplicados
                operationProgress.message += ` (Advertencia rsync: ${errorMsg.substring(0, 100)})`;
            }
        }
    });

    currentOperationProcess.on('close', (code) => {
        console.log("[BACKEND start-operation] Proceso rsync finalizado con código:", code);
        if (cancelFlag) {
            operationProgress.status = 'cancelled';
            operationProgress.message = `${operationMode === 'copy' ? 'Copia' : 'Sincronización'} cancelada.`;
        } else if (code === 0 || code === 24) { // Código 24: "Partial transfer due to vanished source files" (puede ser OK)
            operationProgress.status = 'completed';
            operationProgress.percentage = 100;
            operationProgress.currentFile = 'Completado';
            operationProgress.message = `${operationMode === 'copy' ? 'Copia' : 'Sincronización'} completada.`;
            if (code === 24) operationProgress.message += " (con algunas advertencias, revisar logs rsync)";
        } else {
            operationProgress.status = 'error';
            operationProgress.message = `${operationMode === 'copy' ? 'Copia' : 'Sincronización'} falló. Código rsync: ${code}.`;
        }
        currentOperationProcess = null; // Liberar el proceso
        cancelFlag = false; // Resetear para la próxima
        console.log("[BACKEND start-operation] Estado final de la operación:", operationProgress.message);
    });

    currentOperationProcess.on('error', (err) => { // Error al intentar ejecutar rsync (ej. comando no encontrado)
        console.error("[BACKEND start-operation] Error al iniciar rsync:", err);
        operationProgress.status = 'error';
        operationProgress.message = `Error al iniciar rsync: ${err.message}`;
        currentOperationProcess = null;
        cancelFlag = false;
    });

    res.json({ message: 'Operación iniciada', operationId: operationProgress.id });
});

// --- Progreso y Cancelación ---
router.get('/progress/:operationId', (req, res) => {
    if (req.params.operationId === operationProgress.id) {
        res.json(operationProgress);
    } else {
        // Si no hay operación con ese ID (o ya finalizó y se reseteó operationProgress.id)
        res.status(404).json({
            id: req.params.operationId,
            status: 'unknown', // O 'finished' o 'expired'
            message: 'ID de operación no encontrado o ya finalizado.'
        });
    }
});

router.post('/cancel/:operationId', (req, res) => {
    if (req.params.operationId === operationProgress.id && currentOperationProcess) {
        console.log("[BACKEND cancel] Solicitud de cancelación recibida para la operación:", operationProgress.id);
        cancelFlag = true; // Marcar para que el stream de stdout/close lo detecten
        if (currentOperationProcess && !currentOperationProcess.killed) {
            currentOperationProcess.kill('SIGTERM'); // Intenta terminarlo suavemente
            // Forzar después de un tiempo si SIGTERM no funciona
            setTimeout(() => {
                if (currentOperationProcess && !currentOperationProcess.killed) {
                    console.warn("[BACKEND cancel] rsync no terminó con SIGTERM, enviando SIGKILL");
                    currentOperationProcess.kill('SIGKILL');
                }
            }, 2000); // 2 segundos de gracia
        }
        operationProgress.status = 'cancelling'; // Actualizar estado inmediatamente para el frontend
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
        // Este 'error' es si el comando en sí no se puede encontrar o ejecutar (ej. 'sudo1' en vez de 'sudo')
        proc.on('error', (err) => {
            console.error(`[BACKEND system] Error al INICIAR ${command} ${args.join(' ')}: ${err.message}`);
            res.status(500).json({ error: `Error al iniciar ${actionName}: ${err.message}. ¿Está '${command}' en el PATH y tiene permisos sudo configurados?` });
        });
    } catch(e) { // Catch para errores síncronos si spawn fallara inmediatamente (muy raro)
         console.error(`[BACKEND system] EXCEPCIÓN al intentar spawn ${command}: ${e.message}`);
         res.status(500).json({ error: `Excepción al intentar ${actionName}: ${e.message}` });
    }
};

router.post('/reboot', (req, res) => executeSystemCommand('sudo', ['reboot'], res, 'Reinicio'));
router.post('/shutdown', (req, res) => executeSystemCommand('sudo', ['shutdown', '-h', 'now'], res, 'Apagado'));

module.exports = router;