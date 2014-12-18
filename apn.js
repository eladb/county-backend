var path = require('path');
var apn = require('apn');
var redis_url = process.env.REDISCLOUD_URL || 'redis://localhost:6379';
var redis = require('redis-url').connect(redis_url);

var prod_connection = new apn.Connection({
  cert: path.join('certs', 'apn-prod.cert.pem'),
  key: path.join('certs', 'apn-prod.key.pem'),
  production: true,
});

var sandbox_connection = new apn.Connection({
  cert: path.join('certs', 'apn-dev.cert.pem'),
  key: path.join('certs', 'apn-dev.key.pem'),
  production: false,
});

exports.register_token = function(key, token) {
  return redis.set('push:' + key, token);
};

exports.send_push = function(key, notification) {
  return redis.get('push:' + key, function(err, token) {
    if (err) {
      console.error('cannot send push to device with key', key, '-', err);
      return;
    }

    var device = new apn.Device(token);

    var note = new apn.Notification();
    Object.keys(notification).forEach(function(key) {
      note[key] = notification[key];
    });

    // note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
    // note.badge = 3;
    // note.sound = "ping.aiff";
    // note.alert = "\uD83D\uDCE7 \u2709 You have a new message";
    // note.payload = {'messageFrom': 'Caroline'};

    console.log('sending push to', key, 'token', token, '-', notification);
    sandbox_connection.pushNotification(note, device);
    prod_connection.pushNotification(note, device);    
  });
};