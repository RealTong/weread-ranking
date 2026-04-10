async function onRequest(context, request) {
  console.log(request.url);
  return request;
}

async function onResponse(context, request, response) {
    // ====== 配置 ======
    var API_URL = "YOUR_API_URL/api/admin/weread/credentials";
    var API_KEY = "YOUR_API_KEY";
    // ==================
    // 1. 过滤判断：检查域名和路径 (如果你在软件UI里配置了匹配规则，这两行也可以省略)
    const url = request.url || "";
    if (url.indexOf("weread.qq.com") === -1 || url.indexOf("/login") === -1) {
        return response;
    }

    // 检查是否有响应体
    if (!response.body) {
        return response;
    }

    console.log("========================================");
    console.log("[WeRead] 捕获到登录响应：" + request.url);
    console.log("========================================");

    try {
        // 2. 解析微信读书的响应 JSON
        const data = JSON.parse(response.body);
        
        const vid = data.vid;
        const skey = data.skey;
        const accessToken = data.accessToken || "";
        const refreshToken = data.refreshToken || "";

        if (!vid || !skey) {
            return response; // 数据不全，直接放行
        }

        console.log("[WeRead] 捕获到登录：vid=" + vid + ", skey=" + skey);

        // 获取请求头 (ProxyPin 的 request.headers 是一个键值对对象)
        const headers = request.headers || {};
        
        // 辅助函数：忽略大小写获取 Header 的值（因为部分客户端 Header 可能会自动转换大小写）
        const getHeader = (key) => {
            const lowerKey = key.toLowerCase();
            for (let k in headers) {
                if (k.toLowerCase() === lowerKey) return headers[k];
            }
            return "";
        };

        // 3. 构造要转发给后端的 Payload
        const payload = {
            vid: String(vid),
            skey: String(skey),
            accessToken: String(accessToken),
            refreshToken: String(refreshToken),
            v: getHeader("v"),
            basever: getHeader("basever"),
            baseapi: getHeader("baseapi"),
            channelId: getHeader("channelId"),
            appver: getHeader("appver"),
            userAgent: getHeader("User-Agent"),
            osver: getHeader("osver")
        };

        // 4. 发送异步请求到你的后端 (使用 ProxyPin 内置的 Fetch API)
        // 注意：这里不用 await 阻塞，让它在后台默默发送即可，不影响正常网络请求的速度
        fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": API_KEY
            },
            body: JSON.stringify(payload)
        }).then(res => {
            console.log("[WeRead] 转发成功，状态码：" + res.status);
        }).catch(err => {
            console.log("[WeRead] 转发失败：" + err);
        });

    } catch (e) {
        // 捕获 JSON 解析或其他逻辑错误
        console.log("[WeRead] 脚本执行错误：" + e.message);
    }

    // 5. 必须将原始的 response 返回，否则客户端将收不到数据
    return response;
}