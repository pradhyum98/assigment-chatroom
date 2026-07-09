import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { setupSocketHandlers } from './socket/socketHandlers';

let io: Server;

export const initIo = (server: HttpServer, corsOptions: any) => {
  io = new Server(server, {
    cors: corsOptions,
    pingTimeout: 10000,
    pingInterval: 5000,
  });
  setupSocketHandlers(io);
  return io;
};

export const getIo = (): Server | null => {
  return io ?? null;
};
export const setIoForTest = (mockIo: any) => {
  io = mockIo;
};
