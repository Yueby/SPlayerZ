/**
 * 独立的 Fastify API 服务器
 * 作为子进程运行,避免 preload 上下文限制
 */

const fastify = require('fastify');
const NeteaseCloudMusicApi = require('@neteasecloudmusicapienhanced/api');

const PORT = 36524;

async function startServer() {
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
    
    // 转换驼峰命名为斜杠路径：playlistDetail -> /playlist/detail
    const route = '/' + name.replace(/([A-Z])/g, '/$1').toLowerCase().replace(/^\//, '');
    
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
    await server.listen({ port: PORT, host: '127.0.0.1' });
    console.log(`✅ Fastify API server started on http://127.0.0.1:${PORT}`);
    console.log(`✅ Registered ${routeCount} API routes`);
  } catch (error) {
    console.error('❌ Failed to start API server:', error);
    process.exit(1);
  }
  
  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('🛑 Shutting down API server...');
    await server.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down API server...');
    await server.close();
    process.exit(0);
  });
}

startServer().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

