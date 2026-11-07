import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();

app.use(express.json());

// Normalizar las rutas para que funcionen
// tanto en Netlify como durante las pruebas locales.
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
// ======================================

app.post("/send-email", validarApiKey, async (req, res) => {
    try {
        const { to, subject, message, senderName } = req.body;

        // Validar campos obligatorios
        if (!to || !subject || !message) {
            return res.status(400).json({
                status: "error",
                message: "Faltan campos obligatorios: to, subject y message."
            });
        }

        // Validar correo electrónico
        if (!esCorreoValido(to)) {
            return res.status(400).json({
                status: "error",
                message: "El correo electrónico del destinatario no es válido."
            });
        }

        // Protección contra CRLF Injection
        const asuntoSeguro = String(subject)
            .replace(/[\r\n]/g, " ")
            .trim();

        if (!asuntoSeguro) {
            return res.status(400).json({
                status: "error",
                message: "El asunto no puede estar vacío."
            });
        }

        const nombreSeguro = escaparHTML(senderName || "Usuario");
        const mensajeSeguro = escaparHTML(message);

        // Configuración SMTP
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT),
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        // Enviar correo
        const info = await transporter.sendMail({
            from: `"${senderName || "API Express"}" <${process.env.SMTP_USER}>`,
            to: to,
            subject: asuntoSeguro,
            text: message,
            html: `
                <div style="font-family: Arial; padding: 20px;">
                    <h2>Mensaje enviado desde nuestra API</h2>
                    <p><strong>Remitente:</strong> ${nombreSeguro}</p>
                    <p>${mensajeSeguro}</p>
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
// EXPORTAR FUNCIÓN PARA NETLIFY
// ======================================

export const handler = serverless(app);