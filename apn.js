var path = require('path');
var apn = require('apn');
var redis = require('./redis');
var redis_client = redis.connect();
var badger = require('./badger');

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
  return redis_client.set('push:' + key, token);
};

exports.send_push = function(key, notification) {
  notification = notification || {};

  return redis_client.get('push:' + key, function(err, token) {
    if (err) {
      console.error('cannot send push to device with key', key, '-', err);
      return;
    }

    if (!token) {
      console.error('no push token for key:', key)
      return;
    }

    var device = new apn.Device(token);

    var note = new apn.Notification();
    Object.keys(notification).forEach(function(key) {
      note[key] = notification[key];
    });

    // add badge count and send notification
    return badger.total_badge_count(key, function(err, badge_count) {
      if (err) {
        console.warn('warning: cannot find badge count for user', key);
        badge_count = '?';
      }
      else {
        note.badge = badge_count;
      }

      console.log('NOTIFY', key, JSON.stringify(notification), '(badge=' + badge_count + ')');
      sandbox_connection.pushNotification(note, device);
      prod_connection.pushNotification(note, device);    
    });
  });
};