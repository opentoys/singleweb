import 'dart:io';

/**
 * @name 自定义请求上下文
 */
class Context {
  String uri = '';
  String method = 'ANY';

  Map<String, String> params = {};
  Map<String, String> queryParams = {};

  List<Handler> handlers = [];
  int statusCode = 200;
  final HttpRequest request;
  final HttpResponse response;
  int _nextIdx = -1;

  /**
   * @name 上下文在请求时初始化
   */
  Context(HttpRequest this.request, HttpResponse this.response) {
    this.uri = request.uri.path;
    this.method = request.method;
  }

  void next() async {
    this._nextIdx++;
    if (this._nextIdx >= this.handlers.length) return;

    try {
      await this.handlers[this._nextIdx](this);
    } catch (e) {
      this.abort();
    }
  }

  void abort() {
    this._nextIdx = this.handlers.length;
  }

  void send(String data) {
    this.response.statusCode = this.statusCode;
    this.response.write(data);
    this.response.close();
  }
}

/**
 * @name Handler 路由定义
 */
typedef Handler = Future<void> Function(Context);

/**
 * @name 路由定义
 */
class Router {
  String uri = '';
  String method = 'ANY';

  List<Handler> handlers = [];

  Map<String, Router> _children = {};
  Map<String, Router> _regexpChildren = {};
  Map<String, Router> _universalChildren = {};

  /**
   * @name 路由定义
   * @param {String} 请求方法
   * @param {String} 定义URI
   */
  Router(String method, String uri) {
    this.method = method;
    if (uri.indexOf("/") == 0) {
      this.uri = uri.substring(1);
    } else {
      this.uri = uri;
    }
    this.handlers = [];
    this._children = new Map<String, Router>();
    this._regexpChildren = new Map<String, Router>();
    this._universalChildren = new Map<String, Router>();
  }

  /**
   * @name 添加路由定义-私有
   * @param {String} 请求方法
   * @param {String} 定义URI
   */
  Router _add(String method, String uri, [Handler? fn]) {
    List<String> uris = uri.split("/").sublist(1);
    Router r = this;
    for (int i = 0; i < uris.length; i++) {
      print(uris[i]);
      Router lr = new Router(method, uris[i]);
      if (lr.uri.indexOf(":") == 0) {
        // 通配
        lr.uri = uris[i].substring(1);
        r._universalChildren[method] = lr;
      } else if (lr.uri.indexOf("#") == 0) {
        // 正则
        lr.uri = uris[i].substring(1);
        r._regexpChildren[method] = lr;
      } else {
        // 精确
        r._children[method+"-"+uris[i]] = lr;
      }
      r = lr;
    }
    if (fn != null) r.handlers = [fn];
    return r;
  }

  /**
   * @name 中间件挂载
   */
  Router use(Handler fn) {
    this.handlers.add(fn);
    return this;
  }

  Router hook(Router r) {
    this._children["${r.method}-${r.uri}"] = r;
    return this;
  }

  /**
   * @name GET方法定义
   */
  void get(String uri, Handler fn) {
    this._add("GET", uri, fn);
  }

  /**
   * @name POST方法定义
   */
  void post(String uri, Handler fn) {
    this._add("POST", uri, fn);
  }

  /**
   * @name 路由分组定义
   */
  Router group(String uri) {
    return this._add("ANY", uri);
  }

  /**
   * @name 路由查找方法
   */
  void find(Context ctx) {
    List<String> uris = ctx.uri.split("/").sublist(1);
    uris.add("");
    Router r = this;
    ctx.handlers.addAll(r.handlers);
    for(var i = 0; i < uris.length; i++) {
      Router? nr = r._children["${ctx.method}-${uris[i]}"] ?? r._children["ANY-${uris[i]}"];
      // 判断正则
      if (nr == null && r._regexpChildren[ctx.method] != null) {
        Router? lr = r._regexpChildren[ctx.method];
        var reg = new RegExp(lr?.uri ?? '');
        if (reg.hasMatch(uris[i])) {
          nr = lr;
          // 正则匹配逻辑
          reg.allMatches(uris[i]).forEach((v) {
            for(var g in v.groupNames.toList()) {
              ctx.params[g] = v.namedGroup(g) ?? '';
            }
          });
        }
      }
      // 判断通配
      if (nr == null && r._universalChildren[ctx.method] != null) {
        nr = r._universalChildren[ctx.method];
        ctx.params[nr?.uri ?? ''] = uris[i];
      }
      // 增加404
      if (nr == null) {
        ctx.handlers.add((Context ctx) async {
          ctx.statusCode = 404;
          ctx.send("Not found");
        });
      } else {
        ctx.handlers.addAll(nr.handlers);
        r = nr;
      }
    }
    ctx.next();
  }
}

/**
 * @name 应用定义
 */
class Application extends Router {
  HttpServer? server;
  Application() : super("ANY", "");

  Future<void> listen(String addr, int port) async {
    this.server = await HttpServer.bind(addr, port);
    this.server?.listen((req) {
      var ctx = new Context(req, req.response);
      this.find(ctx);
    });
  }
}