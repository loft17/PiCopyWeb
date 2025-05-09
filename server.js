const express = require('express');
const cors = require('cors');
const path = require('path');
const deviceRoutes = require('./routes/api'); // Suponiendo que mueves las rutas

const app = express();
const PORT = process.env.PORT || 3000; // Puerto para la app web

app.use(cors()); // Habilitar CORS para desarrollo
app.use(express.json()); // Para parsear JSON en las peticiones POST
app.use(express.static(path.join(__dirname, 'public'))); // Servir archivos estáticos

// Rutas de la API
app.use('/api', deviceRoutes); // Usa tus rutas definidas en api.js

// Ruta principal para servir el frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => { // Escuchar en todas las interfaces de red
    console.log(`Servidor RPi Web Copier corriendo en http://<IP_DE_TU_PI>:${PORT}`);
});