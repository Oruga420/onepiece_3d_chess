const app=require('./api/app');
const port=Number(process.env.PORT||3000);
app.listen(port,'127.0.0.1',()=>console.log(`Grand Line Chess: http://localhost:${port}`));
