var util         = require("util");
var EventEmitter = require("events").EventEmitter;
var Socket       = require('net').Socket;

var Mirobot = function(){
  this.connected = false;
  this.debug = false;
  this.cbs = {};
  this.robot_state = 'idle';
  this.msg_stack = [];
  this.buffer = "";
  this.bootloading = false;
  EventEmitter.call(this);
}

util.inherits(Mirobot, EventEmitter);

Mirobot.prototype.connect = function(ip){
  if(!this.connected){
    var self = this;
    self.socket = new Socket();
    self.socket.setTimeout(5000);
    self.socket.on('data', function(data){ self.handleData(data) });
    var connectError = function(){
      self.emit('error', {type: 'connect', msg: "Can't connect to Mirobot"});
    }
    self.socket.on('timeout', connectError);
    self.socket.on('error', connectError);
    self.socket.on('connect', function(){
      self.socket.setTimeout(0);
      self.version(function(msg){
        this.version = msg.msg;
        self.emit('connect');
      });
    });

    self.socket.connect(8899, ip);
  }
}

Mirobot.prototype.close = function(){
  this.socket.end();
}

Mirobot.prototype.forward = function(distance, cb){
  this.send({cmd: 'forward', arg: distance}, cb);
}

Mirobot.prototype.back = function(distance, cb){
  this.send({cmd: 'back', arg: distance}, cb);
}

Mirobot.prototype.left = function(angle, cb){
  this.send({cmd: 'left', arg: angle}, cb);
}

Mirobot.prototype.right = function(angle, cb){
  this.send({cmd: 'right', arg: angle}, cb);
}

Mirobot.prototype.penup = function(cb){
  this.send({cmd: 'penup'}, cb);
}

Mirobot.prototype.pendown = function(cb){
  this.send({cmd: 'pendown'}, cb);
}

Mirobot.prototype.ping = function(cb){
  this.send({cmd: 'ping'}, cb);
}

Mirobot.prototype.stop = function(cb){
  var self = this;
  this.send({cmd:'stop'}, function(state, recursion){
    if(state === 'complete' && !recursion){
      for(var i in self.cbs){
        self.cbs[i]('complete', true);
      }
      self.robot_state = 'idle';
      self.msg_stack = [];
      self.cbs = {};
      if(cb){ cb(state); }
    }
  });
}

Mirobot.prototype.pause = function(cb){
  this.send({cmd:'pause'}, cb);
}

Mirobot.prototype.resume = function(cb){
  this.send({cmd:'resume'}, cb);
}

Mirobot.prototype.ping = function(cb){
  this.send({cmd:'ping'}, cb);
}

Mirobot.prototype.version = function(cb){
  this.send({cmd:'version'}, cb);
}

Mirobot.prototype.reset = function(cb){
  this.send({cmd:'reset'}, cb);
}

Mirobot.prototype.updateFirmware = function(hex, cb){
  var self = this;
  // restart in bootloader mode
  this.reset(function(){
    self.bootloading = true;
    var Stk500v1 = require('./stk500v1.js').Stk500v1;
    var bl = new Stk500v1(self.socket);
    bl.debug = self.debug
    // Connect to bootloader
    bl.connect(30, function(success){
      if(success){
        console.log('Connected to bootloader');
        bl.updateFirmware(hex, cb);
      }else{
        console.log("Couldn't connect to bootloader");
        cb(false);
      }
    });
  });
}

Mirobot.prototype.timeout = function(id){
  if(this.cbs[id]){
    this.cbs[id]('error', {msg: 'Message response timed out'});
  }
}

Mirobot.prototype.send = function(msg, cb){
  var self = this;
  msg.id = Math.random().toString(36).substr(2, 10)
  if(cb){
    this.cbs[msg.id] = cb;
  }
  if(msg.arg){ msg.arg = msg.arg.toString(); }
  if(['stop', 'pause', 'resume', 'ping', 'version'].indexOf(msg.cmd) >= 0){
    if(this.debug){ console.log("Sent: " + JSON.stringify(msg)); }
    this.sendTimeout = setTimeout(function(){ self.timeout(msg.id); }, 2000);
    this.socket.write(JSON.stringify(msg) + "\r\n");
  }else{
    this.push_msg(msg);
  }
}

Mirobot.prototype.push_msg = function(msg){
  this.msg_stack.push(msg);
  this.run_stack();
}

Mirobot.prototype.run_stack = function(){
  var self = this;
  if(this.robot_state === 'idle' && this.msg_stack.length > 0){
    this.robot_state = 'receiving';
    if(this.debug){ console.log("Sent: " + JSON.stringify(this.msg_stack[0])); }
    this.sendTimeout = setTimeout(function(){ self.timeout(this.msg_stack[0].id); }, 2000);
    this.socket.write(JSON.stringify(this.msg_stack[0]) + "\r\n");
  }
},

Mirobot.prototype.processMsg = function(msg){
  if(this.debug){ console.log("Received: " + msg); }
  msg = JSON.parse(msg);
  if(this.msg_stack.length > 0 && this.msg_stack[0].id == msg.id){
    clearTimeout(this.sendTimeout);
    if(msg.status === 'accepted'){
      if(this.cbs[msg.id]){
        this.cbs[msg.id]('started', msg);
      }
      this.robot_state = 'running';
    }else if(msg.status === 'complete'){
      if(this.cbs[msg.id]){
        this.cbs[msg.id]('complete', msg);
        delete this.cbs[msg.id];
      }
      this.msg_stack.shift();
      if(this.msg_stack.length === 0){
        this.emit('program_complete');
      }
      this.robot_state = 'idle';
      this.run_stack();
    }
  }else{
    if(this.cbs[msg.id]){
      this.cbs[msg.id]('complete', msg);
      delete this.cbs[msg.id];
    }
  }
}

Mirobot.prototype.handleData = function(_msg){
  if(this.bootloading) return;
  if(_msg){
    this.buffer += _msg.toString();
  }
  var split_buf = this.buffer.split("\r\n")
  if(split_buf.length > 1){
    this.buffer = this.buffer.replace(/.*\r\n/, '');
    this.processMsg(split_buf[0]);
    this.handleData();
  }
}

exports.Mirobot = Mirobot;

