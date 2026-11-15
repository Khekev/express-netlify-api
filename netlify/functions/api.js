
import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { getStore } from "@netlify/blobs";

dotenv.config();

const app = express();

app.use(express.json());

// ======================================
// NORMALIZAR RUTAS PARA NETLIFY Y LOCAL
// ======================================

app.use((req, res, next) => {
    const prefixes = [
        "/.netlify/functions/api",
        "/api"
    ];

    for (const prefix of prefixes) {
        if (req.url === prefix || req.url.startsWith(prefix + "/")) {
            req.url = req.url.slice(prefix.length) || "/";
            break;
        }
    }

    next();
});

// ======================================
// GET /api/time
// CONSULTAR HORA DEL SERVIDOR
// ======================================

app.get("/time", (req, res) => {
    const now = new Date();

    res.status(200).json({
        status: "success",
        serverTimeISO: now.toISOString(),
        timestamp: now.getTime(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        formatted: now.toLocaleString("es-MX"),
        platform: process.platform
    });
});

// ======================================
// VALIDAR API KEY
// ======================================

function validarApiKey(req, res, next) {
    const apiKey = req.headers["x-api-key"];
    const secretKey = process.env.API_SECRET_KEY;

    if (!secretKey || !apiKey || apiKey !== secretKey) {
        return res.status(401).json({
            status: "error",
            message: "No autorizado. API Key inválida o faltante."
        });
    }

    next();
}

// ======================================
// FUNCIONES DE VALIDACIÓN
// ======================================

function esCorreoValido(correo) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}

function escaparHTML(texto) {
    return String(texto).replace(/[&<>"']/g, caracter => {
        const entidades = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entidades[caracter];
    });
}

// ======================================
// POST /api/send-email
// ENVIAR CORREOS
// ======================================

app.post("/send-email", validarApiKey, async (req, res) => {
    try {
        const { to, subject, message, senderName } = req.body;

        if (!to || !subject || !message) {
            return res.status(400).json({
                status: "error",
                message: "Faltan campos obligatorios: to, subject y message."
            });
        }

        if (!esCorreoValido(to)) {
            return res.status(400).json({
                status: "error",
                message: "El correo electrónico del destinatario no es válido."
            });
        }

        const asuntoSeguro = String(subject)
            .replace(/[\r\n]/g, " ")
            .trim();

        const remitenteSeguro = String(senderName || "API Express")
            .replace(/[\r\n"]/g, " ")
            .trim();

        if (!asuntoSeguro) {
            return res.status(400).json({
                status: "error",
                message: "El asunto no puede estar vacío."
            });
        }

        const nombreHTML = escaparHTML(senderName || "Usuario");
        const mensajeHTML = escaparHTML(message);

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT),
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        const info = await transporter.sendMail({
            from: `"${remitenteSeguro}" <${process.env.SMTP_USER}>`,
            to: to,
            subject: asuntoSeguro,
            text: String(message),
            html: `
                <div style="font-family: Arial; padding: 20px;">
                    <h2>Mensaje enviado desde nuestra API</h2>
                    <p><strong>Remitente:</strong> ${nombreHTML}</p>
                    <p>${mensajeHTML}</p>
                    <hr>
                    <small>Correo enviado mediante Express y Netlify Functions.</small>
                </div>
            `
        });

        return res.status(200).json({
            status: "success",
            message: "Correo enviado correctamente.",
            messageId: info.messageId
        });

    } catch (error) {
        console.error("Error al enviar correo:", error);

        return res.status(500).json({
            status: "error",
            message: "No se pudo enviar el correo. Verifica la configuración SMTP."
        });
    }
});

// ======================================
// NETLIFY BLOBS
// ALMACÉN DE MÉTRICAS
// ======================================

function obtenerAlmacenMetricas() {
    return getStore({
        name: "funnel-metrics",
        consistency: "strong"
    });
}

// Obtener todos los eventos guardados

async function obtenerEventos() {
    const store = obtenerAlmacenMetricas();
    const { blobs } = await store.list();

    const eventos = await Promise.all(
        blobs.map(async (blob) => {
            return await store.get(blob.key, {
                type: "json"
            });
        })
    );

    return eventos.filter(Boolean);
}

// ======================================
// POST /api/metrics
// REGISTRAR UNA MÉTRICA
// ======================================

app.post("/metrics", async (req, res) => {
    try {
        const { step, source, sessionId, metadata } = req.body || {};

        if (
            typeof step !== "string" ||
            !step.trim() ||
            typeof source !== "string" ||
            !source.trim()
        ) {
            return res.status(400).json({
                status: "error",
                message: "Los campos step y source son obligatorios."
            });
        }

        const randomSuffix = Math.random()
            .toString(36)
            .substring(2, 7);

        const eventId = `metric_${Date.now()}_${randomSuffix}`;
        const timestamp = new Date().toISOString();

        const metricRecord = {
            id: eventId,
            step: step.toLowerCase().trim(),
            source: source.toLowerCase().trim(),
            sessionId: sessionId || "anon_guest",
            metadata: metadata && typeof metadata === "object" ? metadata : {},
            timestamp
        };

        const store = obtenerAlmacenMetricas();

        await store.setJSON(eventId, metricRecord);

        return res.status(201).json({
            status: "success",
            message: "Métrica guardada correctamente.",
            data: metricRecord
        });

    } catch (error) {
        console.error("Error al registrar métrica:", error);

        return res.status(500).json({
            status: "error",
            message: "Error al guardar la métrica.",
            details: error.message
        });
    }
});

// ======================================
// GET /api/metrics
// CONSULTAR Y FILTRAR MÉTRICAS
// ======================================

app.get("/metrics", async (req, res) => {
    try {
        const { step, source } = req.query;

        let eventos = await obtenerEventos();

        if (step) {
            eventos = eventos.filter(evento =>
                evento.step === String(step).toLowerCase().trim()
            );
        }

        if (source) {
            eventos = eventos.filter(evento =>
                evento.source === String(source).toLowerCase().trim()
            );
        }

        eventos.sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

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

        return res.status(200).json({
            status: "success",
            data: {
                summary,
                recentEvents: eventos.slice(0, 50)
            }
        });

    } catch (error) {
        console.error("Error al consultar métricas:", error);

        return res.status(500).json({
            status: "error",
            message: "Error al consultar las métricas.",
            details: error.message
        });
    }
});

// ======================================
// GET /api/metrics/export?format=csv
// EXPORTAR MÉTRICAS A CSV
// ======================================

app.get("/metrics/export", async (req, res) => {
    try {
        const { format } = req.query;

        if (format !== "csv") {
            return res.status(400).json({
                status: "error",
                message: "Formato no válido. Utiliza format=csv."
            });
        }

        const eventos = await obtenerEventos();

        const encabezados = [
            "id",
            "step",
            "source",
            "sessionId",
            "timestamp"
        ];

        const filas = eventos.map(evento => [
            evento.id,
            evento.step,
            evento.source,
            evento.sessionId,
            evento.timestamp
        ]);

        function escaparCSV(valor) {
            const texto = String(valor ?? "");
            return `"${texto.replace(/"/g, '""')}"`;
        }

        const contenidoCSV = [
            encabezados,
            ...filas
        ]
            .map(fila => fila.map(escaparCSV).join(","))
            .join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");

        res.setHeader(
            "Content-Disposition",
            'attachment; filename="metricas_funnel.csv"'
        );

        return res.status(200).send("\uFEFF" + contenidoCSV);

    } catch (error) {
        console.error("Error al exportar CSV:", error);

        return res.status(500).json({
            status: "error",
            message: "Error al exportar las métricas.",
            details: error.message
        });
    }
});

// ======================================
// EXPORTAR FUNCIÓN PARA NETLIFY
// ======================================

export const handler = serverless(app);
