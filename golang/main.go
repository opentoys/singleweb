package main

import (
	"fmt"
)

func main() {
	app := NewApplication()
	// 全局中间件
	app.Use(func(ctx *Context) {
		fmt.Println("middleware by app start")
		// request
		ctx.Next() // 后边使用 async 异步函数时, 使用 await/ .then方法调用
		// response
		fmt.Println("middleware by app end")
	})

	router := NewRouter("ANY", "/api")
	group := router.Group("/customer")

	router.Use(func(ctx *Context) {
		fmt.Println("middleware by router start")
		ctx.Next()
		fmt.Println("middleware by router end")
	})

	group.Use(func(ctx *Context) {
		fmt.Println("middleware by group start")
		ctx.Next()
		fmt.Println("middleware by group end")
	})

	group.GET("/:id", func(ctx *Context) {
		ctx.Send("hello " + ctx.Params["id"])
	})

	group.GET("/#[a-z]", func(ctx *Context) {
		ctx.Send("hello customer regex")
	})

	group.GET("/info", func(ctx *Context) {
		ctx.Send("hello customer info")
	})

	group.POST("/:id", func(ctx *Context) {
		ctx.Send(`hello post` + ctx.Params["id"])
	})

	router.GET("/data", func(ctx *Context) {
		ctx.Send("hello data")
	})

	app.Hook(router)

	app.Listen(":12346")
}
