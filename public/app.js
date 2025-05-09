// public/app.js
document.addEventListener('DOMContentLoaded', () => {
    // Selectores de Navegación
    const navSdCopyBtn = document.getElementById('navSdCopy');
    const navBackupSyncBtn = document.getElementById('navBackupSync');
    const navSystemBtn = document.getElementById('navSystem');

    // Secciones (Vistas)
    const sdCopySection = document.getElementById('sdCopySection');
    const backupSyncSection = document.getElementById('backupSyncSection');
    const systemSection = document.getElementById('systemSection');
    const allSections = [sdCopySection, backupSyncSection, systemSection];

    // Elementos Comunes de Progreso
    const progressSectionEl = document.querySelector('.progress-section');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const currentFileEl = document.getElementById('currentFile');
    const etaEl = document.getElementById('eta');
    const cancelOperationButton = document.getElementById('cancelOperationButton');

    // --- Elementos Sección Copia SD ---
    const sdSourceDeviceSelect = document.getElementById('sdSourceDevice');
    const sdDestinationDeviceSelect = document.getElementById('sdDestinationDevice');
    const sdSourceInfoEl = document.getElementById('sdSourceInfo');
    const sdDestinationInfoEl = document.getElementById('sdDestinationInfo');
    const sdCopyDateInput = document.getElementById('sdCopyDate');
    const sdCameraMakeInput = document.getElementById('sdCameraMake'); // Solo este se usa para el nombre de carpeta
    // sdCameraModelInput ya no existe en el HTML, así que no necesitamos un selector para él
    const startSdCopyButton = document.getElementById('startSdCopyButton');

    // --- Elementos Sección Sincronizar Backup ---
    const syncSourceDeviceSelect = document.getElementById('syncSourceDevice');
    const syncDestinationDeviceSelect = document.getElementById('syncDestinationDevice');
    const syncSourceInfoEl = document.getElementById('syncSourceInfo');
    const syncDestinationInfoEl = document.getElementById('syncDestinationInfo');
    const startSyncButton = document.getElementById('startSyncButton');

    // --- Elementos Sección Sistema ---
    const rebootButton = document.getElementById('rebootButton');
    const shutdownButton = document.getElementById('shutdownButton');

    let devicesCache = [];
    let currentOperationId = null;
    let progressInterval = null;

    // --- Lógica de Navegación ---
    function showSection(sectionToShow) {
        allSections.forEach(section => {
            if (section) section.style.display = 'none';
        });
        if (sectionToShow) sectionToShow.style.display = 'block';

        const navButtons = [navSdCopyBtn, navBackupSyncBtn, navSystemBtn];
        navButtons.forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        if (sectionToShow === sdCopySection && navSdCopyBtn) navSdCopyBtn.classList.add('active');
        else if (sectionToShow === backupSyncSection && navBackupSyncBtn) navBackupSyncBtn.classList.add('active');
        else if (sectionToShow === systemSection && navSystemBtn) navSystemBtn.classList.add('active');
    }

    if (navSdCopyBtn) navSdCopyBtn.addEventListener('click', () => showSection(sdCopySection));
    if (navBackupSyncBtn) navBackupSyncBtn.addEventListener('click', () => showSection(backupSyncSection));
    if (navSystemBtn) navSystemBtn.addEventListener('click', () => showSection(systemSection));

    // --- Funciones Auxiliares ---
    function updateUIDateDefaults() {
        if (!sdCopyDateInput) return;
        const today = new Date();
        // Ajustar a la zona horaria local para que la fecha por defecto sea correcta
        const offset = today.getTimezoneOffset(); // offset en minutos
        const todayLocal = new Date(today.getTime() - (offset * 60 * 1000));
        sdCopyDateInput.value = todayLocal.toISOString().split('T')[0];
    }

    async function fetchDevicesAndPopulate() {
        try {
            const response = await fetch('/api/devices');
            if (!response.ok) {
                let errorText = `Error HTTP: ${response.status}`;
                try {
                    const errData = await response.json();
                    errorText = errData.error || errorText;
                } catch (e) { /* ignorar si el cuerpo no es JSON */ }
                throw new Error(errorText);
            }
            devicesCache = await response.json();

            populateDeviceSelect(sdSourceDeviceSelect, devicesCache);
            populateDeviceSelect(sdDestinationDeviceSelect, devicesCache);
            populateDeviceSelect(syncSourceDeviceSelect, devicesCache);
            populateDeviceSelect(syncDestinationDeviceSelect, devicesCache);

            // Actualizar la información mostrada para cada selector
            updateDeviceSelectionInfo(sdSourceDeviceSelect, sdSourceInfoEl);
            updateDeviceSelectionInfo(sdDestinationDeviceSelect, sdDestinationInfoEl);
            updateDeviceSelectionInfo(syncSourceDeviceSelect, syncSourceInfoEl);
            updateDeviceSelectionInfo(syncDestinationDeviceSelect, syncDestinationInfoEl);

        } catch (error) {
            console.error('Error fetching devices:', error);
            if (progressStatus) progressStatus.textContent = `Error al cargar dispositivos: ${error.message}`;
        }
    }

    function populateDeviceSelect(selectElement, devices) {
        if (!selectElement) {
            // console.warn("populateDeviceSelect: selectElement es nulo.");
            return;
        }
        const currentValue = selectElement.value; // Guardar valor actual si existe
        selectElement.innerHTML = '<option value="">-- Seleccionar Dispositivo --</option>';
        if (devices && Array.isArray(devices)) {
            devices.forEach(device => {
                if (device && typeof device.path === 'string' && typeof device.label === 'string') { // Verificar que el dispositivo tiene las propiedades esperadas
                    const option = document.createElement('option');
                    option.value = device.path;
                    const freeGB = device.free_space_gb !== undefined ? device.free_space_gb.toFixed(1) : 'N/A';
                    const totalGB = device.total_space_gb !== undefined ? device.total_space_gb.toFixed(1) : 'N/A';
                    option.textContent = `${device.label} (${freeGB}G de ${totalGB}G libres)`;
                    selectElement.appendChild(option);
                }
            });
        }
        // Restaurar valor si aún es válido y existe en la nueva lista
        if (currentValue && devices && devices.some(d => d && d.path === currentValue)) {
            selectElement.value = currentValue;
        }
    }

    function updateDeviceSelectionInfo(selectElement, infoElement) {
        if (!selectElement || !infoElement) return;
        const selectedPath = selectElement.value;
        infoElement.textContent = 'No seleccionado'; // Default
        if (selectedPath && devicesCache.length > 0) {
            const selectedDevice = devicesCache.find(d => d.path === selectedPath);
            if (selectedDevice) {
                const freeGB = selectedDevice.free_space_gb !== undefined ? selectedDevice.free_space_gb.toFixed(1) : 'N/A';
                const totalGB = selectedDevice.total_space_gb !== undefined ? selectedDevice.total_space_gb.toFixed(1) : 'N/A';
                infoElement.textContent = `${selectedDevice.label} - ${freeGB}GB libres de ${totalGB}GB. (${selectedDevice.device || 'N/A'})`;
            }
        }
    }

    // Event listeners para actualizar info al cambiar selección
    if (sdSourceDeviceSelect) sdSourceDeviceSelect.addEventListener('change', () => updateDeviceSelectionInfo(sdSourceDeviceSelect, sdSourceInfoEl));
    if (sdDestinationDeviceSelect) sdDestinationDeviceSelect.addEventListener('change', () => updateDeviceSelectionInfo(sdDestinationDeviceSelect, sdDestinationInfoEl));
    if (syncSourceDeviceSelect) syncSourceDeviceSelect.addEventListener('change', () => updateDeviceSelectionInfo(syncSourceDeviceSelect, syncSourceInfoEl));
    if (syncDestinationDeviceSelect) syncDestinationDeviceSelect.addEventListener('change', () => updateDeviceSelectionInfo(syncDestinationDeviceSelect, syncDestinationInfoEl));


    // --- Lógica de Operaciones (Copia/Sincronización) ---
    async function startGenericOperation(sourcePath, destinationPath, operationMode, copyDetails = {}) {
        if (!sourcePath || !destinationPath) {
            alert('Por favor, selecciona un origen y un destino.');
            return false;
        }
        if (sourcePath === destinationPath) {
            alert('El origen y el destino no pueden ser el mismo.');
            return false;
        }

        const payload = {
            sourcePath,
            destinationPath,
            operationMode: operationMode === 'sdCopy' ? 'copy' : 'sync',
            ...copyDetails // Contendrá copyDate y cameraMake para sdCopy
        };
        
        if (operationMode === 'sdCopy') {
            if (!payload.cameraMake || payload.cameraMake.trim() === "") {
                 payload.cameraMake = "COPIA_SD"; // Valor por defecto si el usuario no ingresa nada
            }
             if (!payload.copyDate) {
                alert("Por favor, selecciona una fecha para la copia SD.");
                return false;
            }
        }

        if (startSdCopyButton) startSdCopyButton.disabled = true;
        if (startSyncButton) startSyncButton.disabled = true;
        if (cancelOperationButton) cancelOperationButton.style.display = 'block';
        if (progressSectionEl) progressSectionEl.style.display = 'block';
        
        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
        }
        if (currentFileEl) currentFileEl.textContent = 'N/A';
        if (etaEl) etaEl.textContent = '--:--:--';
        if (progressStatus) progressStatus.textContent = 'Iniciando operación...';


        try {
            const response = await fetch('/api/start-operation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Error HTTP: ${response.status}`);
            }

            currentOperationId = data.operationId;
            if (progressStatus) progressStatus.textContent = data.message || "Operación iniciada...";
            pollProgress();
            return true;

        } catch (error) {
            console.error('Error starting operation:', error);
            if (progressStatus) progressStatus.textContent = `Error: ${error.message}`;
            resetOperationUI(false);
            return false;
        }
    }

    if (startSdCopyButton) {
        startSdCopyButton.addEventListener('click', () => {
            const copyDetails = {
                copyDate: sdCopyDateInput ? sdCopyDateInput.value : new Date().toISOString().split('T')[0],
                cameraMake: sdCameraMakeInput ? sdCameraMakeInput.value.trim() : "COPIA_SD"
            };
            startGenericOperation(
                sdSourceDeviceSelect ? sdSourceDeviceSelect.value : null,
                sdDestinationDeviceSelect ? sdDestinationDeviceSelect.value : null,
                'sdCopy',
                copyDetails
            );
        });
    }

    if (startSyncButton) {
        startSyncButton.addEventListener('click', () => {
            startGenericOperation(
                syncSourceDeviceSelect ? syncSourceDeviceSelect.value : null,
                syncDestinationDeviceSelect ? syncDestinationDeviceSelect.value : null,
                'sync'
            );
        });
    }

    // --- Lógica de Progreso y Cancelación ---
    async function pollProgress() {
        if (!currentOperationId) return;
        if (progressInterval) clearInterval(progressInterval);

        progressInterval = setInterval(async () => {
            if (!currentOperationId) { // Doble chequeo por si se limpió mientras tanto
                stopPollingAndResetUI(false);
                return;
            }
            try {
                const response = await fetch(`/api/progress/${currentOperationId}`);
                if (!response.ok) {
                    if (progressStatus) progressStatus.textContent = response.status === 404 ? 'Operación finalizada o no encontrada.' : `Error de conexión: ${response.status}`;
                    stopPollingAndResetUI(false);
                    return;
                }
                const data = await response.json();

                if (progressBar) {
                    progressBar.style.width = `${data.percentage || 0}%`;
                    progressBar.textContent = `${data.percentage || 0}%`;
                }
                if (progressStatus) progressStatus.textContent = `Estado: ${data.message || data.status || 'Desconocido'}`;
                if (currentFileEl) currentFileEl.textContent = `Elemento: ${data.currentFile || 'N/A'}`;
                if (etaEl) etaEl.textContent = `ETA: ${data.eta || '--:--:--'}`;

                if (data.status === 'completed' || data.status === 'error' || data.status === 'cancelled') {
                    stopPollingAndResetUI(data.status === 'completed');
                    if (data.status === 'completed') alert('¡Operación completada exitosamente!');
                    else if (data.status === 'error') alert(`Error en la operación: ${data.message || 'Error desconocido'}`);
                    else if (data.status === 'cancelled') alert('Operación cancelada por el usuario.');
                }
            } catch (error) {
                console.error('Error polling progress:', error);
                if (progressStatus) progressStatus.textContent = 'Error al obtener progreso.';
                stopPollingAndResetUI(false); // Detener si hay error de red en el polling
            }
        }, 1500);
    }

    function stopPollingAndResetUI(success = false) {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        currentOperationId = null; // Importante resetear esto aquí
        resetOperationUI(success);
    }
    
    function resetOperationUI(success){
        if (startSdCopyButton) startSdCopyButton.disabled = false;
        if (startSyncButton) startSyncButton.disabled = false;
        if (cancelOperationButton) cancelOperationButton.style.display = 'none';
        
        // No ocultar la sección de progreso inmediatamente si no fue exitoso,
        // para que el usuario pueda ver el mensaje de estado final.
        // if (success && progressSectionEl) {
        // progressSectionEl.style.display = 'none';
        // }
        fetchDevicesAndPopulate(); // Refrescar dispositivos y su espacio
    }

    if (cancelOperationButton) {
        cancelOperationButton.addEventListener('click', async () => {
            if (!currentOperationId) return;
            try {
                cancelOperationButton.disabled = true;
                const response = await fetch(`/api/cancel/${currentOperationId}`, { method: 'POST' });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || `Error HTTP: ${response.status}`);
                if (progressStatus) progressStatus.textContent = data.message;
                // El polling debería capturar el estado 'cancelled' y limpiar
            } catch (error) {
                console.error('Error cancelling operation:', error);
                alert(`Error al cancelar: ${error.message}`);
            } finally {
                cancelOperationButton.disabled = false;
            }
        });
    }

    // --- Lógica de Control del Sistema ---
    async function systemAction(action) {
        if (!confirm(`¿Estás seguro de que quieres ${action === 'reboot' ? 'REINICIAR' : 'APAGAR'} la Raspberry Pi?`)) return;
        
        const btn = action === 'reboot' ? rebootButton : shutdownButton;
        if (!btn) return; // Salir si el botón no existe
        
        const originalText = btn.textContent;
        btn.textContent = action === 'reboot' ? 'Reiniciando...' : 'Apagando...';
        btn.disabled = true;

        try {
            const response = await fetch(`/api/${action}`, { method: 'POST' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Error HTTP: ${response.status}`);
            alert(data.message + (action === 'shutdown' ? " La conexión se perderá." : ""));
            // Si es shutdown o reboot exitoso, la página puede dejar de responder
        } catch (error) {
            console.error(`Error en ${action}:`, error);
            alert(`Error al ${action}: ${error.message}`);
            btn.textContent = originalText; // Restaurar texto y estado solo si falla
            btn.disabled = false;
        }
    }

    if (rebootButton) rebootButton.addEventListener('click', () => systemAction('reboot'));
    if (shutdownButton) shutdownButton.addEventListener('click', () => systemAction('shutdown'));

    // --- Inicialización ---
    updateUIDateDefaults();
    fetchDevicesAndPopulate();
    if (sdCopySection) { // Asegurarse que la sección existe antes de mostrarla
        showSection(sdCopySection); // Mostrar la sección de Copia SD por defecto
    } else if (allSections.length > 0 && allSections[0]) {
        showSection(allSections[0]); // Mostrar la primera sección disponible
    }
});