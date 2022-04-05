package main

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

// Context 上下文
type Context struct {
	request  *http.Request
	response http.ResponseWriter

	context.Context
	URI         string
	Method      string
	Params      map[string]string
	QueryParams map[string]string
	middleware  []Handler
	nextIdx     int
	StatusCode  int
}

// NewContext 创建上下文
func NewContext(res http.ResponseWriter, req *http.Request) *Context {
	return &Context{
		request:     req,
		response:    res,
		Context:     context.Background(),
		URI:         req.URL.Path,
		Method:      req.Method,
		StatusCode:  200,
		Params:      make(map[string]string),
		QueryParams: make(map[string]string),
		middleware:  make([]Handler, 0),
		nextIdx:     -1,
	}
}

// Next 下一步
func (c *Context) Next() {
	c.nextIdx++
	if c.nextIdx >= len(c.middleware) {
		return
	}
	c.middleware[c.nextIdx](c)
}

// Send 发送响应
func (c *Context) Send(data string) {
	c.response.WriteHeader(c.StatusCode)
	fmt.Fprintf(c.response, data)
}

// Handler 定义函数类型
type Handler func(*Context)

// Router 路由类
type Router struct {
	method            string
	uri               string
	middleware        []Handler
	children          map[string]*Router
	regexChildren     map[string]*Router
	universalChildren map[string]*Router
}

// NewRouter 创建router
func NewRouter(method, uri string) *Router {
	if strings.HasPrefix(uri, "/") {
		uri = uri[1:]
	}
	return &Router{
		uri:               uri,
		method:            method,
		children:          make(map[string]*Router),
		regexChildren:     make(map[string]*Router),
		universalChildren: make(map[string]*Router),
		middleware:        make([]Handler, 0),
	}
}

func (r *Router) add(method, uri string, handlers ...Handler) *Router {
	us := strings.Split(uri, "/")
	us = us[1:]
	var nr *Router = r
	for _, v := range us {
		// 创建临时变量
		lr := NewRouter(method, v)
		// 通配
		if strings.HasPrefix(v, ":") {
			lr.uri = v[1:]
			nr.universalChildren[method] = lr
		} else if strings.HasPrefix(v, "#") {
			// 正则
			lr.uri = v[1:]
			nr.regexChildren[method] = lr
		} else {
			// 精准匹配
			nr.children[method+"-"+v] = lr
		}
		// 依次循环创建路由
		nr = lr
	}
	// 只挂载在最后一级路由上
	nr.middleware = append(nr.middleware, handlers...)
	return nr
}

// Hook 挂载路由
func (r *Router) Hook(routers ...*Router) {
	for _, route := range routers {
		r.children[route.method+"-"+route.uri] = route
	}
}

// Use 中间件
func (r *Router) Use(handlers ...Handler) {
	r.middleware = append(r.middleware, handlers...)
}

// GET 请求类型
func (r *Router) GET(uri string, handlers ...Handler) {
	r.add("GET", uri, handlers...)
}

// POST 请求类型
func (r *Router) POST(uri string, handlers ...Handler) {
	r.add("POST", uri, handlers...)
}

// Group 分组
func (r *Router) Group(uri string, handlers ...Handler) *Router {
	nr := r.add("ANY", uri)
	nr.middleware = append(nr.middleware, handlers...)
	return nr
}

func (r *Router) find(ctx *Context) {
	us := strings.Split(ctx.URI, "/")
	us = us[1:]
	var nr *Router = r
	ctx.middleware = append(ctx.middleware, nr.middleware...)
	// 循环查找路由
	for i := 0; i < len(us); i++ {
		// 临时变量
		lr := nr.children[ctx.Method+"-"+us[i]]
		if lr == nil {
			// 如无匹配, 则查询通配方法
			lr = nr.children["ANY-"+us[i]]
		}
		// 再次, 匹配正则
		if lr == nil {
			lr = nr.regexChildren[ctx.Method]
			if lr != nil {
				// 解析参数
				// 编译正则, 判断是否捕获
				reg := regexp.MustCompile(lr.uri)
				if !reg.MatchString(us[i]) {
					lr = nil
				} else {
					// 获取捕获参数
					result := reg.FindStringSubmatch(us[i])
					for k, v := range reg.SubexpNames() {
						if v != "" {
							ctx.Params[v] = result[k]
						}
					}
				}
			}
		}
		// 再次, 通配
		if lr == nil {
			lr = nr.universalChildren[ctx.Method]
			if lr != nil {
				// 解析参数
				ctx.Params[lr.uri] = us[i]
			}
		}
		if lr != nil {
			ctx.middleware = append(ctx.middleware, lr.middleware...)
			nr = lr
		} else {
			i = len(us)
			ctx.middleware = append(ctx.middleware, func(ctx *Context) {
				ctx.StatusCode = 404
				ctx.Send("Not Found")
			})
		}
	}

	ctx.Next()
}

// Application 入口
type Application struct {
	*Router
}

// NewApplication 初始化项目
func NewApplication() *Application {
	a := &Application{
		Router: NewRouter("ANY", ""),
	}

	return a
}

func (a *Application) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := NewContext(w, r)
	a.find(ctx)
}

// Listen 监听服务
func (a *Application) Listen(addr string) {
	http.ListenAndServe(addr, a)
}
