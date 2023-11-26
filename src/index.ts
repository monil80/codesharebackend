import { Server, Socket } from "socket.io";
import pino from "pino";
import pretty from "pino-pretty";
import express from 'express';
import serverless from 'serverless-http';
import dotenv from 'dotenv';
import cors from 'cors';
import http from 'http'

dotenv.config();

const app = express();
const router = express.Router();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
    },
});

app.use(cors(), express.json());

router.get("/", (req, res) => {
    res.send(
        `${process.env.SERVICE_NAME}  ---> start at port ${process.env.PORT}`
    );
});


const stream = pretty({
    colorize: true,
    colorizeObjects: true,
    mkdir: true,
});
const logger = pino(stream);

// const io = new Server(8800, {
//     cors: {
//         origin: "http://localhost:3000",
//     },
// });

const activeUsersMap = new Map<string, Set<string>>();
const pageDataMap = new Map<string, string>();

io.on("connection", (socket: Socket) => {
    function sendMessageToPageUsers(newPageId: string, message: string) {
        if (activeUsersMap.has(newPageId)) {
            const socketIds = activeUsersMap.get(newPageId);
            if (socketIds) {
                socketIds.forEach((socketId) => {
                    io.to(socketId).emit("session-expire", message);
                });
            }
        }
    }
    function sendMessageToInvelidPageUsers(socketId: string, message: string) {
        io.to(socketId).emit("invelid-session", message);
    }

    socket.on("new-page-add", (newPageId) => {
        if (!activeUsersMap.has(newPageId)) {
            activeUsersMap.set(newPageId, new Set());
            pageDataMap.set(newPageId, "");

            const sessionTimeout = setTimeout(() => {
                sendMessageToPageUsers(newPageId, "your session is expired.");
                activeUsersMap.delete(newPageId);
                pageDataMap.delete(newPageId);
                logger.info("active pages:", Array.from(activeUsersMap.keys()));
            }, 1 * 60 * 1000); // 10 minutes in milliseconds
        }

        logger.info("active pages:", Array.from(activeUsersMap.keys()));
        io.emit("get-pages", Array.from(activeUsersMap.keys()));
    });

    socket.on("new-user-add", (newPageId) => {
        if (!activeUsersMap.has(newPageId)) {
            sendMessageToInvelidPageUsers(
                socket.id,
                "your session is expired or path is not valid"
            );
            console.log(activeUsersMap);
            return;
        }
        activeUsersMap.get(newPageId)?.add(socket.id);

        const otherUsersData = pageDataMap.get(newPageId);

        socket.emit("other-users-data", otherUsersData);
        logger.info(activeUsersMap);
        io.emit("get-pages", Array.from(activeUsersMap.keys()));
    });

    socket.on("disconnect", () => {
        for (const [userId, socketIds] of activeUsersMap.entries()) {
            if (socketIds.has(socket.id)) {
                socketIds.delete(socket.id);

                break;
            }
        }
        logger.info("active user", activeUsersMap);
        io.emit("get-pages", Array.from(activeUsersMap.keys()));
    });

    socket.on(
        "send-message",
        (data: { newPageId: string; message: string; sessionId: string }) => {
            const { newPageId, message, sessionId } = data;

            const socketIds = activeUsersMap.get(newPageId);
            pageDataMap.set(newPageId, message);

            if (socketIds) {
                for (const socketId of socketIds) {
                    if (socketId !== sessionId) {
                        io.to(socketId).emit("receive-message", { newPageId, message });
                    }
                }
            }
        }
    );
});
server.listen(process.env.PORT, () => {
    console.log(
        `\u001b[36m${process.env.SERVICE_NAME}  ---> \u001b[33m start at port ${process.env.PORT}`
    );
});

app.on("error", (error) => {
    console.error(`\u001b[31m Failed to start server`);
    process.exit(1);
});

app.use('/.netlify/functions/server', router);
export const handler = serverless(app);