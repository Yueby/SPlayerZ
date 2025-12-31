/**
 * 独立的 Fastify API 服务器
 * 作为子进程运行,避免 preload 上下文限制
 */

const fastify = require('fastify');
const NeteaseCloudMusicApi = require('@neteasecloudmusicapienhanced/api');
const fs = require('fs');
const path = require('path');

const BASE_PORT = 36524;
const MAX_PORT_ATTEMPTS = 10;

// 端口信息文件路径
const PORT_INFO_FILE = path.join(__dirname, '.api-port.json');

async function findAvailablePort(startPort) {
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = startPort + i;
    const server = fastify({ logger: false });
    
    try {
      await server.listen({ port, host: '127.0.0.1' });
      await server.close();
      return port;
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${port} is in use, trying next port...`);
        continue;
      }
      throw error;
    }
  }
  
  throw new Error(`Failed to find available port after ${MAX_PORT_ATTEMPTS} attempts`);
}

async function startServer() {
  // 查找可用端口
  const port = await findAvailablePort(BASE_PORT);
  console.log(`🔍 Found available port: ${port}`);
  
  // 保存端口信息到文件
  fs.writeFileSync(PORT_INFO_FILE, JSON.stringify({ port, timestamp: Date.now() }));
  
  const server = fastify({ 
    logger: false,
    trustProxy: true,
  });
  
  // 注册插件
  await server.register(require('@fastify/cookie'));
  await server.register(require('@fastify/multipart'));
  
  // CORS 支持
  server.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    reply.header('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {
      reply.code(200).send();
    }
  });
  
  // 注册所有网易云音乐 API
  let routeCount = 0;
  Object.entries(NeteaseCloudMusicApi).forEach(([name, handler]) => {
    if (typeof handler !== 'function') return;
    
    // 转换下划线命名为斜杠路径：login_status -> /login/status
    const route = '/' + name.replace(/_/g, '/');
    
    const handleRequest = async (req, reply) => {
      try {
        // 合并所有参数
        const params = {
          ...req.query,
          ...req.body,
        };
        
        // 解码 cookie
        if (params.cookie) {
          params.cookie = decodeURIComponent(params.cookie);
        }
        
        // 调用 API
        const result = await handler(params);
        reply.send(result.body);
      } catch (error) {
        console.error(`❌ API error [${route}]:`, error.message);
        reply.code(500).send({ 
          code: 500, 
          message: error.message 
        });
      }
    };
    
    // 注册斜杠格式的路由
    server.get(route, handleRequest);
    server.post(route, handleRequest);
    routeCount++;
  });
  
  // 启动服务器
  try {
    await server.listen({ port, host: '127.0.0.1' });
    console.log(`✅ Fastify API server started on http://127.0.0.1:${port}`);
    console.log(`✅ Registered ${routeCount} API routes`);
  } catch (error) {
    console.error('❌ Failed to start API server:', error);
    // 删除端口信息文件
    if (fs.existsSync(PORT_INFO_FILE)) {
      fs.unlinkSync(PORT_INFO_FILE);
    }
    process.exit(1);
  }
  
  // 优雅关闭
  const cleanup = async () => {
    console.log('🛑 Shutting down API server...');
    await server.close();
    // 删除端口信息文件
    if (fs.existsSync(PORT_INFO_FILE)) {
      fs.unlinkSync(PORT_INFO_FILE);
    }
    process.exit(0);
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  return port;
}

startServer().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

