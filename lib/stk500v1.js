var hex2bin = function(hex){
  var rawhex = ''
  hex.split('\n').map(function(line){
    var linelength = parseInt(line.slice(1, 3), 16);
    if(linelength && line.slice(7, 9) === '00') {
      rawhex += line.slice(9, 9 + 2 * linelength);
    }
  });
  return new Buffer(rawhex, 'hex');
}

var Stk500v1 = function(conn){
  var self = this;
  this.conn = conn;
  this.buffer = '';
  this.conn.on('data', function(data){ self.handleData(data); });
  this.success_cb = undefined;
  this.pageSize = 128;
  this.debug = false;
}

Stk500v1.prototype.connect = function(attempts, cb){
  var self = this;
  var success = false;

  if(attempts === 0){
    cb(false);
    return;
  }

  self.writeCmd("0 ", function(succ){
    if(succ){
      success = true;
      cb(true);
    }else{
      self.connect(--attempts, cb);
    }
  });
}

Stk500v1.prototype.loadAddress = function(addr, cb){
  var buf = new Buffer('U\0\0 ');
  buf.writeInt16LE(addr >> 1, 1);
  this.writeCmd(buf, cb);
}

Stk500v1.prototype.programPage = function(data, cb){
  var buf = new Buffer('d\0\0F');
  buf.writeInt16BE(data.length, 1);
  buf = Buffer.concat([buf, data, (new Buffer(' '))])
  this.writeCmd(buf, cb);
}

Stk500v1.prototype.updateFirmware = function(hex, cb){
  var bin = hex2bin(hex);
  this._updateFW(bin, 0, cb);
}

Stk500v1.prototype._updateFW = function(bin, offset, cb){
  var self = this;
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
        if(self.debug) console.log("Programmed page: " + offset);
        self._updateFW(bin, offset + self.pageSize, cb)
      });
    }else{
      cb(false);
    }
  });
}

Stk500v1.prototype.writeCmd = function(cmd, cb){
  var self = this;
  var success = false;
  self.success_cb = function(){
    success = true;
    cb(true);
  }
  if(self.debug) console.log("Writing:")
  if(self.debug) console.log(cmd)
  self.conn.write(cmd);
  setTimeout(function(){
    if(!success){
      cb(false);
    }
  }, 100);
}

Stk500v1.prototype.handleData = function(data){
  this.buffer += data;
  if(this.debug) console.log("Incoming:");
  if(this.debug) console.log(data);
  if (this.buffer.slice(-2) === '\x14\x10') {
    this.buffer = '';
    if(this.success_cb) this.success_cb(true);
  }
}

exports.Stk500v1 = Stk500v1;

