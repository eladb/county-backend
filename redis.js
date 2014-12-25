var redis_url = process.env.REDISCLOUD_URL || 'redis://localhost:6379';

exports.connect = function(client_name) {
  client_name = client_name || 'unknown';
  client_name = '[' + client_name + ']';
  var client = require('redis-url').connect(redis_url);
  client.on('ready', function() {
    console.log(client_name, 'redis client connected to:', redis_url);
  });
  client.on('error', function(err) {
    console.error(client_name, 'error connecting to redis at:', redis_url, '--', err);
  });
  return client;
};