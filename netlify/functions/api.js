import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { getStore, connectLambda } from "@netlify/blobs";

dotenv.config();

const app = express();

app.use(express.json({ limit: "10kb" }));

// ==========================================
// CONFIGURACIÓN DE RUTAS
// ==========================================
// Quita el prefijo /api o /.netlify/functions/api para que Express
// vea siempre rutas como /metrics, /time, etc.

app.use((req, res, next) => {
    let nueva = req.url.replace(
        /^\/(\.netlify\/functions\/)?api(?=\/|\?|$)/,
        ""
    );

    if (!nueva.startsWith("/")) {
        nueva = "/" + nueva;
    }

    req.url = nueva;
    next();
});

// ==========================================
// CONFIGURACIÓN DE NETLIFY BLOBS
// ==========================================
// En producción (Netlify) el SDK detecta las credenciales solo,
// siempre que se llame a connectLambda(event) en el handler.
// Las variables locales son únicamente un respaldo opcional.

function obtenerStore(consistencia = "strong") {
    const opciones = {
        name: "funnel-metrics",
        consistency: consistencia
    };

    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_AUTH_TOKEN;

    if (siteID && token) {
        opciones.siteID = siteID;
        opciones.token = token;
    }

    return getStore(opciones);
}

// Ejecuta una operación sobre el store con consistencia fuerte.
// Si el entorno no la soporta (por ejemplo, el emulador local, que no
// entrega "uncachedEdgeURL"), reintenta con consistencia eventual.
async function conStore(operacion) {
    try {
        return await operacion(obtenerStore("strong"));
    } catch (error) {
        if (String(error.message).includes("uncachedEdgeURL")) {
            console.warn(
                "Consistencia fuerte no disponible en este entorno; usando eventual."
            );
            return await operacion(obtenerStore("eventual"));
        }

        throw error;
    }
}

// ==========================================
// RUTA PRINCIPAL
// ==========================================

app.get("/", (req, res) => {
    res.json({
        status: "success",
        message: "API REST funcionando correctamente",
        endpoints: [
            "GET /api/time",
            "POST /api/send-email",
            "POST /api/metrics",
            "GET /api/metrics",
            "GET /api/metrics/export?format=csv"
        ]
    });
});

// ==========================================
// CONSULTAR HORA DEL SERVIDOR
// ==========================================

app.get("/time", (req, res) => {
    res.status(200).json({
        status: "success",
        message: "Hora del servidor consultada correctamente",
        time: new Date().toISOString()
    });
});

// ==========================================
// VALIDACIÓN DE API KEY
// ==========================================

function validarApiKey(req, res, next) {
    const apiKey = req.headers["x-api-key"];

    if (!process.env.API_SECRET_KEY) {
        return res.status(500).json({
            status: "error",
            message: "No se configuró API_SECRET_KEY."
        });
    }

    if (apiKey !== process.env.API_SECRET_KEY) {
        return res.status(401).json({
            status: "error",
            message: "API Key incorrecta o no proporcionada."
        });
    }

    next();
}

// ==========================================
// ESCAPAR HTML
// ==========================================

function escaparHTML(texto) {
    return String(texto).replace(/[&<>"']/g, (caracter) => {
        const equivalencias = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return equivalencias[caracter];
    });
}

// ==========================================
// CONFIGURACIÓN DE CORREO
// ==========================================

function crearTransportador() {
    const puerto = Number(process.env.SMTP_PORT || 587);

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: puerto,
        secure: puerto === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

// ==========================================
// ENVIAR CORREO ELECTRÓNICO
// ==========================================

app.post("/send-email", validarApiKey, async (req, res) => {
    try {
        const { to, subject, message, senderName } = req.body;

        if (!to || !subject || !message) {
            return res.status(400).json({
                status: "error",
                message: "Debes proporcionar to, subject y message."
            });
        }

        // Protección contra CRLF Injection en campos que viajan en cabeceras
        const camposCabecera = [to, subject, senderName];

        if (
            camposCabecera.some(
                (valor) =>
                    valor !== undefined &&
                    (typeof valor !== "string" || /[\r\n]/.test(valor))
            )
        ) {
            return res.status(400).json({
                status: "error",
                message: "Los campos to, subject y senderName deben ser texto sin saltos de línea."
            });
        }

        const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!correoValido.test(to)) {
            return res.status(400).json({
                status: "error",
                message: "El correo destinatario no es válido."
            });
        }

        if (
            !process.env.SMTP_HOST ||
            !process.env.SMTP_USER ||
            !process.env.SMTP_PASS
        ) {
            return res.status(500).json({
                status: "error",
                message: "Faltan las credenciales SMTP."
            });
        }

        const transporter = crearTransportador();

        const nombre = escaparHTML(senderName || "API");
        const contenido = escaparHTML(message);

        await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.SMTP_USER,
            to,
            subject,
            text: message,
            html: `
                <div style="font-family: Arial, sans-serif;">
                    <h2>${nombre}</h2>
                    <p>${contenido}</p>
                </div>
            `
        });

        return res.status(200).json({
            status: "success",
            message: "Correo enviado correctamente."
        });

    } catch (error) {
        console.error("Error al enviar correo:", error);

        return res.status(500).json({
            status: "error",
            message: "Error al enviar el correo.",
            details: error.message
        });
    }
});

// ==========================================
// OBTENER TODOS LOS EVENTOS
// ==========================================

async function obtenerEventos() {
    return conStore(async (store) => {
        const resultado = await store.list();

        const eventos = await Promise.all(
            resultado.blobs.map((blob) =>
                store.get(blob.key, { type: "json" })
            )
        );

        return eventos.filter(Boolean);
    });
}

// ==========================================
// REGISTRAR MÉTRICA (POST /api/metrics)
// ==========================================

app.post("/metrics", async (req, res) => {
    try {
        const { step, source, sessionId, metadata } = req.body;

        if (typeof step !== "string" || typeof source !== "string") {
            return res.status(400).json({
                status: "error",
                message: 'Los campos "step" y "source" son obligatorios y deben ser texto.'
            });
        }

        const stepLimpio = step.toLowerCase().trim();
        const sourceLimpio = source.toLowerCase().trim();

        if (!stepLimpio || !sourceLimpio) {
            return res.status(400).json({
                status: "error",
                message: 'Los campos "step" y "source" no pueden estar vacíos.'
            });
        }

        if (stepLimpio.length > 50 || sourceLimpio.length > 50) {
            return res.status(400).json({
                status: "error",
                message: "step y source no pueden exceder 50 caracteres."
            });
        }

        const metadataValida =
            metadata &&
            typeof metadata === "object" &&
            !Array.isArray(metadata) &&
            JSON.stringify(metadata).length <= 2000;

        const id =
            "metric_" +
            Date.now() +
            "_" +
            Math.random().toString(36).substring(2, 7);

        const nuevaMetrica = {
            id,
            step: stepLimpio,
            source: sourceLimpio,
            sessionId:
                typeof sessionId === "string" && sessionId.trim()
                    ? sessionId.trim().slice(0, 100)
                    : "anon_guest",
            metadata: metadataValida ? metadata : {},
            timestamp: new Date().toISOString()
        };

        await conStore((store) => store.setJSON(id, nuevaMetrica));

        return res.status(201).json({
            status: "success",
            message: "Métrica persistida correctamente en Netlify Blobs.",
            data: nuevaMetrica
        });

    } catch (error) {
        console.error("Error al registrar métrica:", error);

        return res.status(500).json({
            status: "error",
            message: "Fallo interno al persistir la métrica.",
            details: error.message
        });
    }
});

// ==========================================
// CONSULTAR MÉTRICAS (GET /api/metrics)
// Filtros opcionales: ?step=...&source=...&limit=...
// ==========================================

app.get("/metrics", async (req, res) => {
    try {
        let eventos = await obtenerEventos();

        const step = String(req.query.step || "").toLowerCase().trim();
        const source = String(req.query.source || "").toLowerCase().trim();

        if (step) {
            eventos = eventos.filter((e) => e.step === step);
        }

        if (source) {
            eventos = eventos.filter((e) => e.source === source);
        }

        // Más recientes primero
        eventos.sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        );

        // Resumen calculado sobre TODOS los eventos filtrados
        const summary = {
            totalEvents: eventos.length,
            byStep: {},
            bySource: {}
        };

        for (const evento of eventos) {
            summary.byStep[evento.step] =
                (summary.byStep[evento.step] || 0) + 1;

            summary.bySource[evento.source] =
                (summary.bySource[evento.source] || 0) + 1;
        }

        // La lista se limita para no devolver miles de registros
        const limite = Math.min(
            Math.max(Number(req.query.limit) || 50, 1),
            200
        );

        return res.status(200).json({
            status: "success",
            data: {
                summary,
                recentEvents: eventos.slice(0, limite)
            }
        });

    } catch (error) {
        console.error("Error al consultar métricas:", error);

        return res.status(500).json({
            status: "error",
            message: "Fallo interno al consultar métricas en Netlify Blobs.",
            details: error.message
        });
    }
});

// ==========================================
// EXPORTAR MÉTRICAS A CSV
// GET /api/metrics/export?format=csv
// ==========================================

function escaparCSV(valor) {
    let texto = String(valor ?? "");

    // Evita inyección de fórmulas al abrir en Excel / Sheets
    if (/^[=+\-@]/.test(texto)) {
        texto = "'" + texto;
    }

    return `"${texto.replace(/"/g, '""')}"`;
}

app.get("/metrics/export", async (req, res) => {
    try {
        const formato = req.query.format || "csv";

        if (formato !== "csv") {
            return res.status(400).json({
                status: "error",
                message: "Formato no válido. Utiliza format=csv."
            });
        }

        const eventos = await obtenerEventos();

        eventos.sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        );

        const encabezados = ["id", "step", "source", "sessionId", "timestamp"];

        const filas = eventos.map((evento) =>
            encabezados.map((campo) => escaparCSV(evento[campo])).join(",")
        );

        const csv = [encabezados.join(","), ...filas].join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            'attachment; filename="metricas_funnel.csv"'
        );

        return res.status(200).send("\uFEFF" + csv);

    } catch (error) {
        console.error("Error al exportar CSV:", error);

        return res.status(500).json({
            status: "error",
            message: "Error al exportar las métricas.",
            details: error.message
        });
    }
});

// ==========================================
// RUTAS NO ENCONTRADAS
// ==========================================

app.use((req, res) => {
    res.status(404).json({
        status: "error",
        message: "Ruta no encontrada.",
        path: req.path
    });
});

// ==========================================
// MANEJO GENERAL DE ERRORES
// ==========================================

app.use((error, req, res, next) => {
    // JSON malformado o demasiado grande → error del cliente, no del servidor
    if (error.type === "entity.parse.failed") {
        return res.status(400).json({
            status: "error",
            message: "El cuerpo de la petición no es un JSON válido."
        });
    }

    if (error.type === "entity.too.large") {
        return res.status(413).json({
            status: "error",
            message: "El cuerpo de la petición es demasiado grande."
        });
    }

    console.error("Error general:", error);

    res.status(500).json({
        status: "error",
        message: "Ocurrió un error interno en la API."
    });
});

// ==========================================
// EXPORTAR FUNCIÓN NETLIFY
// ==========================================

const manejadorExpress = serverless(app);

export const handler = async (event, context) => {
    // Conecta Netlify Blobs con el entorno de esta ejecución
    connectLambda(event);

    return manejadorExpress(event, context);
};