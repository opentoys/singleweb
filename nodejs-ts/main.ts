import { Router, Context, Application} from './web';

const app = new Application();

// 全局中间件
app.use((ctx: Context) => {
    console.log("middleware by app start");
    // request
    ctx.next(); // 后边使用 async 异步函数时, 使用 await/ .then方法调用
    // response
    console.log("middleware by app end");
});

app.get("/io", (ctx: Context) => {
    ctx.send("hello io");
});

const router = new Router("/api");
const group = router.group("/customer");

router.use((ctx: Context) => {
    console.log("middleware by router start");
    ctx.next();
    console.log("middleware by router end");
});

group.use((ctx: Context) => {
    console.log("middleware by group start");
    ctx.next();
    console.log("middleware by group end");
});

group.get("/:id", (ctx: Context) => {
    ctx.send("hello ${ctx.params.id}");
});

group.get("/#[a-z]", (ctx: Context) => {
    ctx.send("hello customer regex");
});

group.get("/info", (ctx: Context) => {
    ctx.send("hello customer info");
});

group.post("/:id", (ctx: Context) => {
    ctx.send(`hello post ${ctx.params.get('id')}`);
});

router.get("/data", (ctx: Context) => {
    ctx.send("hello data");
});

// 挂载路由, 可以实现函数重载的语言, 使用 app.use(router) 即可
app.hook(router);

app.listen("12345");