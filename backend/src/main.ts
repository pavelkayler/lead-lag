import { bootstrap } from './app/bootstrap.js';
import { attachRpc, createHttpServer } from './ws/rpcServer.js';

const app = bootstrap();
const server = createHttpServer();
attachRpc(server, app);
const port = Number(process.env.PORT || 8080);
server.listen(port, () => console.log(`backend listening on :${port}`));
