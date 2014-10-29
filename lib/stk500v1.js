var util         = require("util");
var EventEmitter = require("events").EventEmitter;

var hex2bin = function(hex){
  var rawhex = ''
  hex.toString().split('\n').map(function(line){
    var linelength = parseInt(line.slice(1, 3), 16);
    if(linelength && line.slice(7, 9) === '00') {
      rawhex += line.slice(9, 9 + 2 * linelength);
    }
  });
  return new Buffer(rawhex, 'hex');
}

var equalBuf = function(buf1, buf2){
  if(buf1.length === buf2.length){
    for(var i = 0; i< buf1.length; i++){
      if(buf1[i] !== buf2[i]){
        return false;
      }
    }
  }else{
    return false;
  }
  return true;
}

var Stk500v1 = function(conn){
  var self = this;
  this.conn = conn;
  this.buffer = new Buffer('');
  this.listener = function(data){ self.handleData(data); };
  this.conn.on('data', this.listener);
  this.success_cb = undefined;
  this.pageSize = 128;
  this.debug = false;
  EventEmitter.call(this);
}

util.inherits(Stk500v1, EventEmitter);

Stk500v1.prototype.connect = function(attempts, cb){
  var self = this;
  var success = false;

  if(attempts === 0){
    
    cb(false);
    return;
  }

  self.writeCmd("0 ", 0, function(succ){
    if(succ){
      success = true;
      cb(true);
    }else{
      self.connect(--attempts, cb);
    }
  });
}

Stk500v1.prototype.close = function(){
  this.conn.removeListener('data', this.listener);
}

Stk500v1.prototype.loadAddress = function(addr, cb){
  var buf = new Buffer('U\0\0 ');
  buf.writeInt16LE(addr >> 1, 1);
  this.writeCmd(buf, 0, cb);
}

Stk500v1.prototype.programPage = function(data, cb){
  var buf = new Buffer('d\0\0F');
  buf.writeInt16BE(data.length, 1);
  buf = Buffer.concat([buf, data, (new Buffer(' '))])
  this.writeCmd(buf, 0, cb);
}

Stk500v1.prototype.readPage = function(len, cb){
  var buf = new Buffer('t\0\0F ');
  buf.writeInt16BE(len, 1);
  this.writeCmd(buf, len, cb);
}

Stk500v1.prototype.updateFirmware = function(hex, cb){
  var bin = hex2bin(hex);
  this._updateFW(bin, 0, cb);
}

Stk500v1.prototype._updateFW = function(bin, offset, cb){
  var self = this;
  self.progress = 0;
  if(self.debug) console.log("Programming page: " + offset);
  self.loadAddress(offset, function(succ){
    if(succ){
      //slice the page we need
      var pageLen = Math.min(bin.length - offset, self.pageSize);
      if(pageLen <= 0){
        if(self.debug) console.log("All pages written");
        cb(true);
        return;
      }
      var page = bin.slice(offset, offset + pageLen);
      self.programPage(page, function(succ){
        self.loadAddress(offset, function(succ){
          if(succ){
            self.readPage(page.length, function(succ, resp){
              if(succ && equalBuf(page, resp)){
                var prog = ((offset / bin.length) * 100).toFixed();
                if(prog !== self.progress){
                  self.progress = prog;
                  self.emit('progress', self.progress);
                }
                if(self.debug) console.log("Programmed : " + prog + '%');
                self._updateFW(bin, offset + self.pageSize, cb)
              }else{
                cb(false);
              }
            });
          }else{
            cb(false);
          }
        })
      });
    }else{
      cb(false);
    }
  });
}

Stk500v1.prototype.writeCmd = function(cmd, expectedBytes, cb){
  var self = this;
  var success = false;
  self.expectedBytes = expectedBytes;
  self.success_cb = function(resp){
    success = true;
    cb(true, resp);
  }
  if(self.debug) console.log("Writing:")
  if(self.debug) console.log(cmd)
  self.conn.write(cmd);
  setTimeout(function(){
    if(!success){
      cb(false);
    }
  }, 200);
}

Stk500v1.prototype.handleData = function(data){
  this.buffer = Buffer.concat([this.buffer, data]);
  if(this.buffer.length >= 2 + this.expectedBytes){
    if(this.debug) console.log("Incoming:");
    if(this.debug) console.log(this.buffer);
    if (this.buffer[0] === 20 && this.buffer[1 + this.expectedBytes] === 16) {
      var respData = this.buffer.slice(1, 1 + this.expectedBytes);
      this.buffer = new Buffer('');
      if(this.success_cb){
        var ref = this.success_cb;
        this.success_cb = undefined;
        ref(respData);
      }
    }
  }
}

exports.Stk500v1 = Stk500v1;

