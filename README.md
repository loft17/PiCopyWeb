
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
