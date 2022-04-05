import * as http from "http";

export class Context {
    request: http.IncomingMessage;
    response: http.ServerResponse;
    query: URLSearchParams;
    body: any;
    url: string;
    method: string;
    params: Map<String, string> = new Map<String, string>();
    session: any;
    isEnd: boolean = false;
    nextInx: number = -1;
    statusCode:number = 200;
    middleware:Handler[] = [];
    errorHandler: (err: Error, ctx: Context) => Promise<void>;
    responseHeader: Map<String, string> = new Map<String, string>();
    constructor(req: http.IncomingMessage, res: http.ServerResponse) {
        this.request = req;
        this.response = res;
        let u = new URL("http://a.com"+req.url);
        this.url = u.pathname;
        this.query = u.searchParams;
        this.method = req.method?.toLocaleUpperCase() ?? "GET";
        this.errorHandler = async (err, ctx) => {};
    }

    timeout(time: number){
        if (time <= 0) return;
        setTimeout(() => {
            this.statusCode = 500;
            this.send("server timeout");
        }, time);
    }

    next(info?: any) {
        this.nextInx += 1;
        console.log(this.nextInx)
        if (this.nextInx >= this.middleware.length || this.isEnd) return;

        try {
            this.middleware[this.nextInx](this);
        } catch (err) {
            this.nextInx = this.middleware.length -1;
            this.errorHandler(err, this);
        }
    }

    send(str: string) {
        if (this.isEnd) return;
        this.response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        for(let key in this.responseHeader.keys()) {
            this.response.setHeader(key, this.responseHeader.get(key) ?? '');
        }
        this.response.statusCode = this.statusCode || 200;
        this.response.write(str);
        this.response.end();
        this.isEnd = true;
    }

    json(str: Object) {
        if (this.isEnd) return;
        this.response.setHeader('Content-Type', 'application/json; charset=utf-8');
        for(let key in this.responseHeader.keys()) {
            this.response.setHeader(key, this.responseHeader.get(key) ?? '');
        }
        this.response.statusCode = this.statusCode || 200;
        this.response.write(str);
        this.response.end();
        this.isEnd = true;
    }

    setHeader(key: string, value: string) {
        this.responseHeader.set(key, value);
    }
}

// 顺序为优先级
enum RouteTreeType {
    // 通配
    universal,
    // 正则
    regex,
    // 准确
    accurate,
}

// 顺序为优先级
enum RouteTreeMethod {
    get = 'GET',
    post = 'POST',
    put = 'PUT',
    patch = 'PATCH',
    delete = 'DELETE',
    head = 'HEAD',
    options = 'OPTIONS',

    any = 'ANY',
}

export type Handler=(ctx: Context) => Promise<void> | void;

export class Router {
    // 默认路由
    uri: string = '';
    // 子路由
    childrenRoute:Map<string, Router> = new Map<string, Router>();
    middleware:Handler[] = [];
    method: RouteTreeMethod = RouteTreeMethod.any;
    type: RouteTreeType = RouteTreeType.accurate;
    regexChild: Map<string, Router> = new Map<string, Router>();
    universalChild: Map<string, Router> = new Map<string, Router>();

    constructor(u: string) {
        if (u.indexOf('/') == 0) u = u.substr(1);
        if (u.indexOf(':') == 0) {
            this.type = RouteTreeType.universal;
        }

        if (u.indexOf('#') == 0) {
            this.type = RouteTreeType.regex;
        }

        this.uri = u ?? '';
    }

    hook(r: Router) {
        this.childrenRoute.set(`ANY-${r.uri}`, r);
    }

    use(...a:Handler[]) {
        this.middleware.push(...a);
    }

    get(uri: string, ...params: Handler[]) {
        return this.any('GET', uri, ...params);
    }

    post(uri: string, ...params: Handler[]) {
        return this.any('POST', uri, ...params);
    }

    any(method: string, uri: string, ...handler: Handler[]) {
        if (uri.indexOf('/') == 0) uri = uri.substr(1);
        const uris = uri.split('/');
        let r: Router = this;
        for(let u of uris) {
            let nr = new Router(u);
            if (u.indexOf(':') == 0) {
                nr.type = RouteTreeType.universal;
                nr.uri = nr.uri.substr(1);
                r.universalChild.set(method, nr);
            } else if (u.indexOf('#') == 0) {
                nr.type = RouteTreeType.regex;
                nr.uri = nr.uri.substr(1);
                r.regexChild.set(method, nr);
            } else {
                r.childrenRoute.set(`${method}-${u}`, nr);
            }
            r = nr;
        }

        r.middleware.push(...handler);

        return r;
    }

    group(prefix: string) {
        return this.any('ANY', prefix);
    }

    prefix(prefix: string) {
        return this.any('ANY', prefix);
    }

    toString() :string {
        console.log(this);
        for(let key of this.childrenRoute.keys()) {
            this.childrenRoute.get(key)?.toString();
        }
        return "";
    }

    find(ctx: Context, uris?: string[]) {
        uris = uris ?? [...ctx.url.substr(1).split('/'), ""];
        let r: Router|null = this;
        ctx.middleware.push(...r?.middleware ?? []);
        // 查询递归执行子路由
        for(let i = 0; i < uris.length; i++) {
            // 执行当前中间件
            let nr: Router|null = r?.childrenRoute.get(`${ctx.method}-${uris[i]}`) ?? r?.childrenRoute.get(`ANY-${uris[i]}`) ?? null;
            if (r?.regexChild.get(ctx.method) && !nr) {
                nr = r.regexChild.get(ctx.method) ?? null;
                if (!nr) break;

                let reg = new RegExp(nr.uri);
                if (!reg.test(uris[i])) {
                    // 正则匹配
                    let result = uris[i].match(reg);
                    if (result?.groups) {
                        for(let k in result.groups) {
                            ctx.params.set(k, result.groups[k])
                        }
                    } else {
                        result?.map((v,k) => {
                            ctx.params.set(`${i}-${k}`, v);
                        });
                    }
                }
            }

            if (r?.universalChild.get(ctx.method) && !nr) {
                nr = r.universalChild.get(ctx.method) ?? null;
                if (nr) ctx.params.set(nr.uri, uris[i]);
            }
            // 如果没有查找到, 则查找模糊匹配项, 优先正则
            r = nr;
            ctx.middleware.push(...r?.middleware ?? []);
        }

        // 如果没有查到最后的路由
        if (!r) ctx.middleware.push(async (ctx) => {
            ctx.statusCode = 404;
            ctx.send('Not found');
        });
        // 最后一次执行
        ctx.next();
    }
}

export class Application extends Router {
    server: http.Server;
    errorHandler: (err: Error, ctx: Context) => Promise<void>;
    constructor() {
        super("");
  
        this.errorHandler = async (err, ctx) => {
            ctx.statusCode = 500;
            ctx.send(err.stack ?? 'server error');
        }
        // 查询中间执行函数
        this.server = http.createServer((req, res) => {
            const ctx = new Context(req, res);
            ctx.errorHandler = this.errorHandler;
            ctx.timeout(10 * 1000);
            this.find(ctx);
        });
    }

    listen(addr: string) {
        this.server.listen(addr);
    }
}