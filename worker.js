/**
 * Cloudflare Workers Proxy
 * 功能完整的代理服务，支持 HTTP/HTTPS/WebSocket 代理
 * 参考: https://proxy.qxq.news/
 */

// 配置项
const CONFIG = {
  DEBUG: false,
  FAVICON_URL: '',
  CUSTOM_DOMAINS: [],
  KV_CACHE_ENABLED: false,
  enableCORS: true,
  enableHTMLRewrite: true,
  rewriteLocation: true,
  enableCache: true,
  cacheTTL: 3600,
  DEFAULT_EXAMPLE_URL: 'http://api.ity.bio/v1', // 默认示例 URL
};

// Base64 URL 解码
function b64Decode(str) {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

// 路由解析
function parseRoute(pathname, search) {
  // 直接完整 URL: /https://example.com 或 /http://example.com
  const fullUrlMatch = pathname.match(/^\/(https?:\/\/.+)$/);
  if (fullUrlMatch) {
    return { url: fullUrlMatch[1] + search, protocol: fullUrlMatch[1].startsWith('https') ? 'https' : 'http' };
  }

  // /https/host/path 或 /http/host/path
  const protoMatch = pathname.match(/^\/(https?)\/([\w.-]+)(.*)$/);
  if (protoMatch) {
    const [, proto, host, path] = protoMatch;
    return { url: `${proto}://${host}${path || '/'}${search}`, protocol: proto };
  }

  // /proxy/:host/:path* → https://:host/:path
  const proxyMatch = pathname.match(/^\/proxy\/([\w.-]+)(.*)$/);
  if (proxyMatch) {
    const [, host, path] = proxyMatch;
    return { url: `https://${host}${path || '/'}${search}`, protocol: 'https' };
  }

  // /proxyport/:host/:port/:path* → https://:host::port/:path
  const proxyPortMatch = pathname.match(/^\/proxyport\/([\w.-]+)\/(\d+)(.*)$/);
  if (proxyPortMatch) {
    const [, host, port, path] = proxyPortMatch;
    return { url: `https://${host}:${port}${path || '/'}${search}`, protocol: 'https' };
  }

  // /proxyb64/:base64_host/:port/:path* → https://[decoded]::port/:path
  const proxyB64Match = pathname.match(/^\/proxyb64\/([A-Za-z0-9_-]+)\/(\d+)(.*)$/);
  if (proxyB64Match) {
    const [, b64Host, port, path] = proxyB64Match;
    const host = b64Decode(b64Host);
    if (host) {
      return { url: `https://${host}:${port}${path || '/'}${search}`, protocol: 'https' };
    }
  }

  // /httpproxy/:host/:path* → http://:host/:path
  const httpProxyMatch = pathname.match(/^\/httpproxy\/([\w.-]+)(.*)$/);
  if (httpProxyMatch) {
    const [, host, path] = httpProxyMatch;
    return { url: `http://${host}${path || '/'}${search}`, protocol: 'http' };
  }

  // /httpproxyport/:host/:port/:path* → http://:host::port/:path
  const httpProxyPortMatch = pathname.match(/^\/httpproxyport\/([\w.-]+)\/(\d+)(.*)$/);
  if (httpProxyPortMatch) {
    const [, host, port, path] = httpProxyPortMatch;
    return { url: `http://${host}:${port}${path || '/'}${search}`, protocol: 'http' };
  }

  // /httpproxyb64/:base64_host/:port/:path* → http://[decoded]::port/:path
  const httpProxyB64Match = pathname.match(/^\/httpproxyb64\/([A-Za-z0-9_-]+)\/(\d+)(.*)$/);
  if (httpProxyB64Match) {
    const [, b64Host, port, path] = httpProxyB64Match;
    const host = b64Decode(b64Host);
    if (host) {
      return { url: `http://${host}:${port}${path || '/'}${search}`, protocol: 'http' };
    }
  }

  // /wss/:host/:path* → wss://:host/:path
  const wssMatch = pathname.match(/^\/wss\/([\w.-]+)(.*)$/);
  if (wssMatch) {
    const [, host, path] = wssMatch;
    return { url: `wss://${host}${path || '/'}${search}`, protocol: 'wss', websocket: true };
  }

  // /ws/:host/:path* → ws://:host/:path
  const wsMatch = pathname.match(/^\/ws\/([\w.-]+)(.*)$/);
  if (wsMatch) {
    const [, host, path] = wsMatch;
    return { url: `ws://${host}${path || '/'}${search}`, protocol: 'ws', websocket: true };
  }

  // /wssport/:host/:port/:path* → wss://:host::port/:path
  const wssPortMatch = pathname.match(/^\/wssport\/([\w.-]+)\/(\d+)(.*)$/);
  if (wssPortMatch) {
    const [, host, port, path] = wssPortMatch;
    return { url: `wss://${host}:${port}${path || '/'}${search}`, protocol: 'wss', websocket: true };
  }

  // /wsport/:host/:port/:path* → ws://:host::port/:path
  const wsPortMatch = pathname.match(/^\/wsport\/([\w.-]+)\/(\d+)(.*)$/);
  if (wsPortMatch) {
    const [, host, port, path] = wsPortMatch;
    return { url: `ws://${host}:${port}${path || '/'}${search}`, protocol: 'ws', websocket: true };
  }

  // /wsb64/:base64_host/:port/:path*
  const wsB64Match = pathname.match(/^\/wsb64\/([A-Za-z0-9_-]+)\/(\d+)(.*)$/);
  if (wsB64Match) {
    const [, b64Host, port, path] = wsB64Match;
    const host = b64Decode(b64Host);
    if (host) {
      return { url: `ws://${host}:${port}${path || '/'}${search}`, protocol: 'ws', websocket: true };
    }
  }

  // /wssb64/:base64_host/:port/:path*
  const wssB64Match = pathname.match(/^\/wssb64\/([A-Za-z0-9_-]+)\/(\d+)(.*)$/);
  if (wssB64Match) {
    const [, b64Host, port, path] = wssB64Match;
    const host = b64Decode(b64Host);
    if (host) {
      return { url: `wss://${host}:${port}${path || '/'}${search}`, protocol: 'wss', websocket: true };
    }
  }

  // /github/* → https://github.com/*
  const githubMatch = pathname.match(/^\/github(.*)$/);
  if (githubMatch) {
    return { url: `https://github.com${githubMatch[1] || '/'}${search}`, protocol: 'https' };
  }

  // /openai/* → https://api.openai.com/*
  const openaiMatch = pathname.match(/^\/openai(.*)$/);
  if (openaiMatch) {
    return { url: `https://api.openai.com${openaiMatch[1] || '/'}${search}`, protocol: 'https' };
  }

  // /gemini/v1/* → https://generativelanguage.googleapis.com/v1/*
  const geminiMatch = pathname.match(/^\/gemini\/v1(.*)$/);
  if (geminiMatch) {
    return { url: `https://generativelanguage.googleapis.com/v1${geminiMatch[1] || '/'}${search}`, protocol: 'https' };
  }

  return null;
}

// 主处理函数
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // 处理根路径 - 返回使用说明页面
    if (url.pathname === '/' || url.pathname === '') {
      return handleHomePage(hostname, env);
    }

    // 健康检查
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // 调试端点
    if (url.pathname === '/debug' || url.pathname.startsWith('/debug')) {
      return handleDebug(request, url);
    }

    // Worker 信息
    if (url.pathname === '/_worker/info') {
      return handleWorkerInfo();
    }

    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    // 解析路由
    const route = parseRoute(url.pathname, url.search);
    if (!route) {
      return new Response('Invalid proxy URL. See / for usage.', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // WebSocket 请求
    if (route.websocket || request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request, route.url);
    }

    // HTTP/HTTPS 代理
    return handleProxy(request, route.url, hostname);
  }
};

// 处理 HTTP/HTTPS 代理
async function handleProxy(request, targetUrl, proxyHostname) {
  try {
    const target = new URL(targetUrl);
    
    // 构建请求头
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.toLowerCase();
      // 跳过 Cloudflare 特定头和 host
      if (lowerKey.startsWith('cf-') || lowerKey === 'host' || 
          lowerKey === 'x-forwarded-for' || lowerKey === 'x-real-ip') {
        continue;
      }
      headers.set(key, value);
    }
    headers.set('Host', target.host);

    // 发送请求
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual'  // 手动处理重定向
    });

    // 处理响应头
    const responseHeaders = new Headers(response.headers);
    
    // CORS 头
    if (CONFIG.enableCORS) {
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
      responseHeaders.set('Access-Control-Allow-Headers', '*');
      responseHeaders.set('Access-Control-Expose-Headers', '*');
      responseHeaders.set('Access-Control-Max-Age', '86400');
    }

    // 移除安全限制头
    responseHeaders.delete('Content-Security-Policy');
    responseHeaders.delete('Content-Security-Policy-Report-Only');
    responseHeaders.delete('X-Frame-Options');
    responseHeaders.delete('X-Content-Type-Options');

    // 处理重定向 Location 头
    if (CONFIG.rewriteLocation && response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        try {
          const locUrl = new URL(location, targetUrl);
          responseHeaders.set('Location', `https://${proxyHostname}/${locUrl.href}`);
        } catch {}
      }
    }

    // HTML 内容重写
    const contentType = response.headers.get('Content-Type') || '';
    if (CONFIG.enableHTMLRewrite && contentType.includes('text/html')) {
      const html = await response.text();
      const rewritten = rewriteHtml(html, targetUrl, proxyHostname);
      return new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });

  } catch (error) {
    return new Response(`Proxy Error: ${error.message}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// HTML 重写
function rewriteHtml(html, targetUrl, proxyHostname) {
  const target = new URL(targetUrl);
  const baseOrigin = `${target.protocol}//${target.host}`;
  const proxyOrigin = `https://${proxyHostname}`;

  // 重写绝对 URL
  html = html.replace(/(href|src|action)=(["'])(https?:\/\/[^"']+)(["'])/gi, (match, attr, q1, url, q2) => {
    return `${attr}=${q1}${proxyOrigin}/${url}${q2}`;
  });

  // 重写相对 URL (以 / 开头)
  html = html.replace(/(href|src|action)=(["'])\/([^"']*)(["'])/gi, (match, attr, q1, path, q2) => {
    return `${attr}=${q1}${proxyOrigin}/${baseOrigin}/${path}${q2}`;
  });

  return html;
}

// WebSocket 处理
async function handleWebSocket(request, targetUrl) {
  // 将 http(s) 转换为 ws(s)
  const wsUrl = targetUrl.replace(/^http/, 'ws');
  
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }

  // 构建 WebSocket 请求头
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (!lowerKey.startsWith('cf-') && lowerKey !== 'host') {
      headers.set(key, value);
    }
  }
  
  const targetUrlObj = new URL(wsUrl);
  headers.set('Host', targetUrlObj.host);

  // 连接到目标 WebSocket
  const targetResponse = await fetch(wsUrl, {
    headers: headers,
  });

  if (targetResponse.webSocket) {
    return new Response(null, {
      status: 101,
      webSocket: targetResponse.webSocket,
    });
  }

  return new Response('WebSocket connection failed', { status: 502 });
}

// CORS 预检响应
function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    }
  });
}

// 调试端点
function handleDebug(request, url) {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    worker: {
      name: 'cloudflare-proxy',
      version: '1.0.0',
    },
    config: {
      enableCORS: CONFIG.enableCORS,
      enableHTMLRewrite: CONFIG.enableHTMLRewrite,
      rewriteLocation: CONFIG.rewriteLocation,
      enableCache: CONFIG.enableCache,
      cacheTTL: CONFIG.cacheTTL,
    },
    request: {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    },
    query: Object.fromEntries(url.searchParams.entries()),
  };

  // 如果有 path 参数，解析它
  const pathParam = url.searchParams.get('path');
  if (pathParam) {
    debugInfo.parsedRoute = parseRoute(pathParam, '');
  }

  return new Response(JSON.stringify(debugInfo, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Worker 信息
function handleWorkerInfo() {
  return new Response(JSON.stringify({
    name: 'cloudflare-proxy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 首页 HTML
function handleHomePage(hostname, env) {
  // 从环境变量获取配置，如果没有则使用默认值
  const defaultUrl = env?.DEFAULT_EXAMPLE_URL || CONFIG.DEFAULT_EXAMPLE_URL;
  const faviconUrl = env?.FAVICON_URL || CONFIG.FAVICON_URL;
  
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Cloudflare Workers Proxy</title>
  <meta name="color-scheme" content="light dark" />
  <meta name="proxy-host" content="${hostname}">
  <meta name="proxy-origin" content="https://${hostname}">
  ${faviconUrl ? `<link rel="icon" type="image/jpeg" href="${faviconUrl}" />` : ''}
  <link rel="stylesheet" href="https://cdn.jsdmirror.com/npm/@unocss/reset/tailwind.min.css" />
  <script>window.__unocss={observe:true}</script>
  <script src="https://cdn.jsdmirror.com/npm/@unocss/runtime/uno.global.js"></script>
  
  <style>
    * { box-sizing: border-box; }
    html, body, #app { height: 100%; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body { padding: 0.5rem; }
    @media (min-width: 768px) { body { padding: 2rem; } }
    .icon-cloud {
      width: 2.5rem; height: 2.5rem;
      background: linear-gradient(135deg, #0ea5e9, #06b6d4);
      -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 7a7.66 7.66 0 0 0-7.5 6.1A6 6 0 0 0 7 25h8.5v-2H7a4 4 0 0 1-.5-8h1.5v-1a5.5 5.5 0 0 1 11 0v1h1.5a3.5 3.5 0 0 1 0 7h-4v2h4a5.5 5.5 0 0 0 1.5-10.8A7.66 7.66 0 0 0 16 7z'/%3E%3C/svg%3E") center/contain;
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 7a7.66 7.66 0 0 0-7.5 6.1A6 6 0 0 0 7 25h8.5v-2H7a4 4 0 0 1-.5-8h1.5v-1a5.5 5.5 0 0 1 11 0v1h1.5a3.5 3.5 0 0 1 0 7h-4v2h4a5.5 5.5 0 0 0 1.5-10.8A7.66 7.66 0 0 0 16 7z'/%3E%3C/svg%3E") center/contain;
    }
  </style>
  
  <script crossorigin src="https://cdn.jsdmirror.com/npm/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://cdn.jsdmirror.com/npm/react-dom@18/umd/react-dom.production.min.js"></script>
  
  <script>
    // 配置注入
    window.__PROXY_CONFIG__ = {
      defaultExampleUrl: ${JSON.stringify(defaultUrl)}
    };
    
    (function(){
      try{
        var saved=localStorage.getItem('theme')||'system';
        var systemDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
        var dark=saved==='dark'||(saved==='system'&&systemDark);
        if(dark)document.documentElement.classList.add('dark');
      }catch(e){}
    })();
  </script>
</head>
<body class="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
  <div id="app">
    <div style="display:flex;align-items:center;justify-content:center;height:100vh">
      <div class="icon-cloud"></div>
    </div>
  </div>
  
  <script src="https://cdn.jsdmirror.com/gh/Luotianyi-0712/proxy@main/core.js"></script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
