export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search
    if (url.pathname.length > 39) { 
        const formdata = new FormData();
        formdata.append("file_id", url.pathname);

        const requestOptions = {
            method: "POST",
            body: formdata,
            redirect: "follow"
        };
        const filePath = await getFilePath(env, url.pathname.split(".")[0].split("/")[2]);
        fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
    }

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    // --- 核心修改开始：定义一个统一的“预览版”返回函数 ---
    const getPreviewResponse = (originalResponse) => {
        const newHeaders = new Headers(originalResponse.headers);
        // 强制改为 inline (在线预览)
        newHeaders.set('Content-Disposition', 'inline');
        
        // 自动修正 Content-Type 保证浏览器能识别图片
        if (url.pathname.endsWith('.png')) {
            newHeaders.set('Content-Type', 'image/png');
        } else if (url.pathname.endsWith('.jpg') || url.pathname.endsWith('.jpeg')) {
            newHeaders.set('Content-Type', 'image/jpeg');
        } else if (url.pathname.endsWith('.gif')) {
            newHeaders.set('Content-Type', 'image/gif');
        }

        return new Response(originalResponse.body, {
            status: originalResponse.status,
            statusText: originalResponse.statusText,
            headers: newHeaders,
        });
    };
    // --- 核心修改结束 ---

    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return getPreviewResponse(response); // 修改处
    }

    if (!env.img_url) {
        return getPreviewResponse(response); // 修改处
    }

    let record = await env.img_url.getWithMetadata(params.id);
    if (!record || !record.metadata) {
        record = {
            metadata: {
                ListType: "None",
                Label: "None",
                TimeStamp: Date.now(),
                liked: false,
                fileName: params.id,
                fileSize: 0,
            }
        };
        await env.img_url.put(params.id, "", { metadata: record.metadata });
    }

    const metadata = {
        ListType: record.metadata.ListType || "None",
        Label: record.metadata.Label || "None",
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
        fileName: record.metadata.fileName || params.id,
        fileSize: record.metadata.fileSize || 0,
    };

    if (metadata.ListType === "White") {
        return getPreviewResponse(response); // 修改处
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    if (env.ModerateContentApiKey) {
        try {
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);

            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;
                    if (moderateData.rating_label === "adult") {
                        await env.img_url.put(params.id, "", { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            }
        } catch (error) {
            console.error("Error during moderation: " + error.message);
        }
    }

    await env.img_url.put(params.id, "", { metadata });

    return getPreviewResponse(response); // 修改处
}

async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;
        const responseData = await res.json();
        const { ok, result } = responseData;
        return ok && result ? result.file_path : null;
    } catch (error) {
        return null;
    }
}
