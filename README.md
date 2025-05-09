# RPi Web USB Copier & Sync

Una aplicación web simple para gestionar copias de seguridad de tarjetas SD y sincronizar discos duros externos, diseñada para ejecutarse en una Raspberry Pi (o cualquier sistema Linux con Node.js). Se controla a través de un navegador web, idealmente desde un dispositivo móvil en la misma red.

![Screenshot (Placeholder)](placeholder.png)
*(Opcional: Reemplaza placeholder.png con una captura de pantalla real de tu aplicación si tienes una)*

## Funcionalidades

*   **Copia de Tarjetas SD:**
    *   Detecta unidades USB (tarjetas SD, pendrives) como origen.
    *   Detecta discos duros USB como destino.
    *   Permite al usuario ingresar un nombre descriptivo para la copia.
    *   Crea una estructura de carpetas organizada por fecha y el nombre proporcionado en el disco de destino: `YYYYMMDD/NOMBRE_PROPORCIONADO_XXXXX`.
    *   Utiliza `rsync` para una copia eficiente.
*   **Sincronización de Discos de Backup:**
    *   Permite seleccionar un disco de origen (backup principal) y un disco de destino (backup secundario).
    *   Copia archivos y carpetas del origen al destino **solo si no existen ya en el destino** (`rsync --ignore-existing`).
*   **Control del Sistema (Raspberry Pi):**
    *   Botones para reiniciar y apagar la Raspberry Pi de forma remota.
*   **Interfaz Web Responsiva:**
    *   Diseñada para ser accesible y usable desde navegadores móviles.
    *   Muestra el progreso de las operaciones de copia/sincronización.
    *   Permite cancelar operaciones en curso.
*   **Detección de Dispositivos:**
    *   Lista automáticamente los dispositivos USB montados y muestra su espacio disponible.

## Motivación

Esta aplicación fue creada para facilitar el proceso de hacer backups de tarjetas SD (principalmente de cámaras fotográficas/vídeo) a un disco duro durante viajes o en situaciones donde no se dispone de un ordenador completo. Adicionalmente, permite mantener un segundo disco duro de backup sincronizado con el principal de forma selectiva.

## Requisitos Previos

*   Una Raspberry Pi (o cualquier máquina Linux).
*   Node.js y npm instalados.
*   `rsync` instalado (generalmente viene por defecto en la mayoría de las distribuciones Linux).
    *   Si no: `sudo apt update && sudo apt install rsync`
*   (Opcional pero recomendado para una mejor detección de dispositivos) `lsblk` (parte de `util-linux`, normalmente preinstalado).
*   Permisos `sudo` configurados para que el usuario que ejecuta la aplicación Node.js pueda ejecutar `reboot` y `shutdown` sin contraseña.

## Configuración de `sudo` (Importante)

Para que los botones de reiniciar y apagar funcionen, el usuario que ejecuta el script de Node.js necesita permisos para ejecutar estos comandos sin necesidad de ingresar una contraseña.

1.  Abre el archivo sudoers para editarlo:
    ```bash
    sudo visudo
    ```
2.  Añade la siguiente línea al final del archivo, reemplazando `nombre_de_usuario` con el nombre de usuario que ejecutará `server.js` (por ejemplo, `pi`):
    ```
    nombre_de_usuario ALL=(ALL) NOPASSWD: /sbin/reboot, /sbin/shutdown
    ```
    **Precaución:** Edita este archivo con cuidado. Un error aquí puede impedir que uses `sudo`.

## Instalación y Ejecución

1.  **Clona el repositorio (o copia los archivos):**
    ```bash
    git clone https://github.com/tu_usuario/tu_repositorio.git
    cd tu_repositorio
    ```
    O si solo tienes los archivos, créa un directorio y cópialos dentro.

2.  **Instala las dependencias de Node.js:**
    En el directorio raíz del proyecto (donde está `package.json`):
    ```bash
    npm install
    npm install express cors fs-extra child_process
    ```
    Esto instalará `express`, `cors`, `fs-extra`.

3.  **Ejecuta el servidor:**
    ```bash
    node server.js
    ```
    Deberías ver un mensaje indicando que el servidor está corriendo, por ejemplo:
    `Servidor RPi Web Copier corriendo en http://<IP_DE_TU_PI>:3000`

4.  **Accede desde tu navegador:**
    Abre un navegador web en tu ordenador o dispositivo móvil (que esté en la misma red que la Raspberry Pi) y navega a la dirección IP de tu Raspberry Pi seguida del puerto 3000.
    Por ejemplo: `http://192.168.1.100:3000` (reemplaza `192.168.1.100` con la IP real de tu Pi).

## Estructura del Proyecto
rpi-web-copier/
├── server.js # Servidor backend Node.js/Express
├── routes/
│ └── api.js # Define las rutas de la API REST
├── public/ # Archivos estáticos para el frontend
│ ├── index.html # Estructura principal de la página web
│ ├── style.css # Estilos CSS
│ └── app.js # Lógica JavaScript del frontend
├── package.json # Metadatos del proyecto y dependencias
├── package-lock.json # Versiones exactas de las dependencias
└── README.md # Este archivo


## Uso

1.  **Conecta tus dispositivos USB:** Asegúrate de que tus tarjetas SD y discos duros estén conectados a la Raspberry Pi y montados por el sistema operativo.
2.  **Abre la interfaz web:** Navega a la IP y puerto de la aplicación.
3.  **Selecciona el modo de operación:**
    *   **Copia SD:** Para copiar de una tarjeta SD a un disco duro.
        *   Selecciona el dispositivo de Origen (SD).
        *   Selecciona el dispositivo de Destino (HDD).
        *   Ingresa la Fecha de Copia.
        *   Ingresa un Nombre para la Carpeta (ej. "FOTOS_VACACIONES_ITALIA").
        *   Haz clic en "INICIAR COPIA SD".
    *   **Sincronizar Backup:** Para copiar archivos/carpetas de un disco de backup principal a uno secundario.
        *   Selecciona el Disco Origen (Backup Principal).
        *   Selecciona el Disco Destino (Backup Secundario).
        *   Haz clic en "INICIAR SINCRONIZACIÓN".
    *   **Sistema:** Para reiniciar o apagar la Raspberry Pi.
4.  **Monitoriza el progreso:** La interfaz mostrará el progreso de la operación.
5.  **Cancelar (Opcional):** Puedes cancelar una operación en curso.

## Posibles Mejoras y TODOs

*   [ ] Autenticación básica para proteger el acceso a la aplicación.
*   [ ] Verificación más robusta del espacio libre antes de iniciar copias grandes.
*   [ ] Posibilidad de expulsar (desmontar de forma segura) los dispositivos USB desde la interfaz.
*   [ ] Logs de operaciones más detallados visibles en la interfaz.
*   [ ] Internacionalización (i18n) para múltiples idiomas.
*   [ ] Pruebas unitarias y de integración.
*   [ ] Empaquetar como un servicio systemd para que se inicie automáticamente.

## Contribuciones

Las contribuciones son bienvenidas. Por favor, abre un issue para discutir cambios importantes o envía un Pull Request.

## Licencia

*(Opcional: Elige una licencia, por ejemplo MIT, Apache 2.0, GPL, etc. Si no especificas, será bajo copyright por defecto)*
Este proyecto está bajo la Licencia MIT - consulta el archivo `LICENSE` para más detalles (si creas uno).

---

Desarrollado por [Tu Nombre/Usuario]
