const { init } = require('./app');
const Config = require('./config');

const app = init();
app.listen(Config.get('PORT') || 3000, () => {
  console.log('chat app listening');
});
