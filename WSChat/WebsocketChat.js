;(function(global, factory){
  global['WSChat'] = factory();
}(this, function(){
  "use strict";
  /*
  ** websocket长连接插件
  ** 对外通过App.WSChat构造函数使用， 以下已做了详细注释
  ** 聊天室的消息、登录、退出、禁言、相互@、主持人消息开关、点赞态度气泡、点赞数、关注/取关、直播观看人数 等都是通过长链接传输数据
  ** by wanghairong@btime.com
  ** 2017.3.10
  ** 2017.8.8 对之前@陈建写的方法做了较大改动和封装，使长连接的使用更方便、简单
  */

  var dcodeIO = this['dcodeIO'];
  if(typeof dcodeIO === 'undefined' || !dcodeIO.ProtoBuf){
    throw (new Error("dep ProtoBuf.js"));
  }

  // ===========================================
  // websocket公共方法
  function WScommon(){
    $.extend(this, {
      reKeepNum: 0, //保持心跳的次数，最多保持60次
      reLinkNum: 0, //重连次数
      _resolve: null, //存放promise的resolve回调
      requestList: {}, //缓存每次请求 
      wsUrl: 'ws://106.39.201.220', //缓存通过/api/config接口请求到的websocket接口地址
      status: 'init', //websocket的状态，默认init，可能值有：open、close
      messageProto: null,  //通过长连接发送、接收消息时用于编码、解码ArrayBuffer数据格式
    });
    this.getMsgProtoFile();
  }
  WScommon.addPrototype({
    bind: function(evtName, callback){
      $(this).off(evtName).on(evtName, callback);
    },
    trigger: function(evtName, data){
      $(this).trigger(evtName, data);
    },
    createWs: function(url){
      console.log('link-ws');
      var that = this;
      var socket = this.socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";

      socket.onopen = function(){ //长链接建立成功
        console.log('link-ws-open');
        that.trigger('open');
        that.status = 'open';
      };
      socket.onclose = function(){
        that.trigger('close');
        that.status = 'close';
      };
      socket.onmessage = function(evt) {
        that.trigger('message', evt.data);
      };
      socket.onerror = function(evt) { //如果你收到一个错误事件，那么你很快会收到一个关闭事件
        that.trigger('error');
      };
    },
    sendMsg: function(body){
      if(this.status === 'open' && this.socket.readyState === WebSocket.OPEN){
        this.socket.send(body);
      }
    },
    bindEvents: function(){
      var that = this;
      var decodeUtf8 = this.decodeUtf8;
      var currentMsg = null;

      this.bind('open', function(evt, msg) {
        // 此时长链接连接成功，触发promise的resolve
        that._resolve && that._resolve(that._resolve);

        var si = setInterval(function() {
          if(that.reKeepNum++ > 60){ //最大重连60次，也就是3个小时内都会保持心跳（长链接未关闭状态下）
            clearInterval(si);
          }
          that.keepHeartBeat(null, true);
        }, 180000); //180000ms，每3分钟保持心跳连接
      });
      this.bind('close', function(evt, msg) { // websocket断开连接后不自动重连， 但用户有任意数据发送时，如点赞、关注、发送消息等，会自动重连
        console.log('whr:', 'websocket is closed');
      });
      this.bind('message', function(evt, msg){
        if (!currentMsg) {
          msg = that.messageProto.decode(msg);
          if (msg.type == 1 || msg.type == 2)currentMsg = msg;
          return;
        }
        var msgHeader = currentMsg;
        currentMsg = null;
        if(msgHeader.type === 1){
          setType1(msg, msgHeader);
        }else if(msgHeader.type === 2){
          setType2(msg, msgHeader);
        }
      });

      function setType1(msg, msgHeader){ //长链接自动下发的消息的处理
        if (msgHeader.request.one_way) {
          that.keepHeartBeat(msgHeader);
        }
        that.trigger('ws-receive', [decodeUtf8(msg), msgHeader.request.method]);
      }
      function setType2(msg, msgHeader){ //请求响应的消息的处理
        var item = that.requestList[msgHeader.sequence];
        if (item && item.callback) {
          if (msgHeader.response.status == 0) {
            item.callback(decodeUtf8(msg));
          } else {
            item.callback(decodeUtf8(msgHeader.response));
          }
        }
      }
    },
    keepHeartBeat: function(msgHeader, isReLink) {
      isReLink ? '' : this.reKeepNum = 0; //不是重连事件时，说明是发送消息，此时将重连次数重新归零
      this.sendMsg(new this.messageProto({
        version: 1,
        sequence: isReLink ? 0 : msgHeader.sequence,
        type: isReLink ? 4 : 3
      }).toArrayBuffer());
    },
    getWsUrl: function(){
      var that = this;
      var url = 'http://api.btime.com/api/config?';
      try{
        $.ajax({
          url: url,
        }).done(function(data){
          data = data.data;
          that.wsUrl = data.ws_url;
          that.connectWs(that.wsUrl);
        })
      }catch(e){
        connectWs(that.wsUrl);
      }
    },
    connectWs: function(wsUrl){
      var that = this;
      this.createWs(wsUrl);
      var reLinkWs = setInterval(function(){
        if(that.status === 'open' || that.reLinkNum++ > 50){ //最多重连50次
          clearInterval(reLinkWs);
        }else{
          console.log("长链接未create成功,重create一次")
          that.createWs(wsUrl);
        }
      },200);
    },
    getMsgProtoFile: function(){
      try {
        this.messageProto = dcodeIO.ProtoBuf.loadProtoFile('./message.proto').build('kite.Header');
      } catch (e) {
        throw (new Error("protoUrl fail"));
      }
    },
    decodeUtf8: function(arrayBuffer){ // 解析ArrayBuffer对象为字符串
      var result = "";
      var i = 0;
      var c = 0;
      var c3 = 0;
      var c2 = 0;

      var data = new Uint8Array(arrayBuffer);
      // If we have a BOM skip it
      if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        i = 3;
      }

      while (i < data.length) {
        c = data[i];

        if (c < 128) {
          result += String.fromCharCode(c);
          i++;
        } else if (c > 191 && c < 224) {
          if (i + 1 >= data.length) {
            throw "UTF-8 Decode failed. Two byte character was truncated.";
          }
          c2 = data[i + 1];
          result += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
          i += 2;
        } else {
          if (i + 2 >= data.length) {
            throw "UTF-8 Decode failed. Multi byte character was truncated.";
          }
          c2 = data[i + 1];
          c3 = data[i + 2];
          if(/[,\]\}\"]/i.test(String.fromCharCode(c3))){
            // 处理乱码问题 by whr 2016.11.17
            result += String.fromCharCode(c);
            result += String.fromCharCode(c2);
            result += String.fromCharCode(c3);
            i += 3;
          }else{
            result += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
            i += 3;
          }
        }
      }
      return result;
    },
  });


  // ==========================================
  // webscoket连接、事件绑定方法

  /*
  ** 重连机制
  ** 1，连接websocket时，每200ms检测一次是否连接成功，如未成功则重新连接，最多重连50次；           
  ** 2，websocket连接成功后，执行promise的resolve回调，然后开始登录chat长连接，确保聊天室、态度气泡等相关业务代码在长连接连接成功后执行、渲染； 
  ** 3，登录chat长链接时，每300ms查询一次是否成功，未成功则重新登录，最多重连20次          
  ** 4，修改目前保持聊天室30分钟的心跳为3个小时；                 
  ** 5，3个小时后或期间因网络原因，长连接连接断开后，当发送消息、点赞、关注等事件发生时，重新连接websocket，并重新登录chat长连接。
  
  ** 此次优化时间 2017.8.8
  ** by: wanghairong@btime.com
  */

  /* 
  ** 代码执行顺序： （注，序号相同表明执行顺序不要求前后
  ** 1，通过$(this).on绑定长链接的open、message、close等事件
  ** 2，通过/config接口获取ws-url
  ** 3，使用ws-url创建websocket实例连接
  ** 4，websocket连接成功后，在websocket的onopen回调中触发$(this).trigger('open')事件，然后执行promise传过去的resolve，然后才会执行 this.Prom.then回调
  ** 4，在业务页面通过 this.receive方法，给$(this).on('ws-receive')绑定事件
  ** 5，在业务页面通过 this.request方法发送"消息"，并触发$(this).trigger('message')事件，根据请求头信息确认是否触发$(this).trigger('ws-receive')事件
  */

  function WS(){
    WScommon.apply(this, arguments);
    var that = this;
    this.Prom = new Promise(function(resolve){
      that._resolve = resolve;
      that.bindEvents();
      that.getWsUrl();
    });
  }
  WS.prototype = new WScommon();
  WS.addPrototype({
    reConnect: function(callback){ //重连websocket
      var that = this;
      $.extend(this, {
        reLinkNum: 0,
        reKeepNum: 0,
        status: 'init',
        Prom: new Promise(function(resolve){
          resolve.fn = callback;
          that._resolve = resolve;
          that.connectWs(that.wsUrl);
        })
      });
    },
    receive: function(callback){ //绑定 服务端传送过来消息时触发的回调
      this.bind('ws-receive', callback);
    },
    requestWs: function(api, param, callback){ //客户端向服务端发送请求
      var item = this.getParam(api, param, callback);
      this.requestList[item.header.sequence] = item;
      this.sendMsg(new this.messageProto(item.header).toArrayBuffer());
      this.sendMsg(item.payload);
    },
    getParam: function(url, payload, callback){
      if (!url || typeof url != 'string') {
        throw (new Error("URL Error"));
      }
      var urlList = url.split('/');
      if (urlList[0] == '') {
        urlList.shift();
      }
      var requestId = this.getRandomId();
      return {
        header: {
          version: 1,
          sequence: requestId,
          type: 1,
          request: {
            service: urlList[0],
            method: urlList[1],
            one_way: false
          }
        },
        payload: payload,
        callback: callback
      }
    },
    getRandomId: function() {
      return Math.ceil(+new Date() * (Math.random() + 1));
    },
  });


  // ===========================================
  // 登录chat聊天室后可进行的方法操作

  //  如何使用 WSChat ？
  //  1，创建一个长连接实例，第一个参数是配置项（如chatApi等），第二个参数是启用重连时执行的login登录函数
  //  var myChat = new App.WSChat();

  //  2，绑定服务端推送消息后的回调
  //  myChat.bindWsEvent({ //绑定 服务端推送消息后的回调，属性名 必须 要与服务端推送过来消息的消息类型名一致
  //    pushLogin: function(e, data){},
  //    pushLogout: function(e, data){},
  //    pushLike: function(e, data){ /*服务端推送点赞信息后的回调*/ }
  //    pushSendMsg: function(e, _data){ /*服务端推送聊天消息后的回调*/ },
  //    pushCommand: function(e, _data){ /*服务端推送 登录、喜欢、分享等指令信息后的回调*/ }
  //    pushFinish: function(e, data){ /*服务端推送 直播结束*/ },
  //    pushDelMsg: function(e, data){ /*服务端推送 删除某一条聊天消息*/ },
  //    pushAuthor: function(e, data){ /*服务端推送关注人数*/},
  //    // ......
  //  });

  //  3，定义要传给服务端的参数
  //  var param = $.extend({}, myChat.publicParam, { /*自定义要传给服务端的参数*/});

  //  4，使用定义好的参数，向服务端发送请求，并根据返回值做回调处理
  //  myChat.request('login', param, function(data){ /*向服务端发送消息，回调参数为服务端返回数据*/})


  function WSChat(config, logincallbak){
    this.WS = new WS();
    $.extend(this, {
      room_id: window.gid,
      publicParam: {  //长链接的公共参数
        os_type: 'pc',
        room_id : window.gid,
        guid: $utils.getCookie("__guid"),
        protocol : 1, //版本号
        chat_type : 1 //聊天室类型，1聊天室2组聊3单聊
      },
      chatApi: {
        login: 'chat/login', // 登录
        logOut: 'chat/logout', // 登出
        sendMsg: 'chat/sendMsg', // 发送信息
        historyMsg: 'chat/historyMsg', // 获取聊天室历史信息
        roomStat: 'chat/roomStat', // 获取喜欢人数和在线人数
        clickLike: 'chat/clickLike', // 点击喜欢
        sub:'chat/sub', //关注
        unSub:'chat/unSub' //取消关注
      },
    }, config);
    this.logincallbak = logincallbak;
    this.eventsArr = []; //缓存绑定的事件名称
    this.receiveCall();
  }

  WSChat.addPrototype({
    receiveCall: function(){//绑定长连接接收到消息后的触发的事件
      var that = this;
      this.WS.receive(function(evt, data, method) { // websocket长连接通过message接收到消息后都会触发此回调
        data = that.parseData(data);
        if(!data)return false;
        that.assignEvent(method, data); //根据method值，分别不同的执行方法，根据method属性判断服务端推送过来的消息是什么类型，而做出不同处理。
      });
    },
    request: function(api, param, callback){
      /*
      ** 客户端跟服务端建立起websocket长连接后，
      ** 可通过此封装函数，向服务端（张有仑）登录、退出、点赞、发送消息、获取历史记录等
      */
      var that = this;
      param = param && JSON.stringify(param) || '';
      if(that.isWsResolveed){
        that.testAndReconnect(_req);
      }else{
        that.WS.Prom.then(function(obj){
          that.isWsResolveed = true;
          _req();
        })
      }
      function _req(){
        that.WS.requestWs(that.chatApi[api], param, function(data){
          data = that.parseData(data);
          if(data && data.code === '0000'){
            data = data.data;
            if(data){
              callback && callback(data);
            }else{
              console.warn('data.data 数据不存在');
            }
          }else{
            console.warn('data数据code码错误，请联系服务端查看原因');
          }
        });
      }
    },
    testAndReconnect: function(callback){ //检测长连接的链接状态，如果连接关闭，则重连
      if(this.WS.status !== 'open'){ 
        this.isWsResolveed = false;
        this.WS.reConnect(callback);
        this.logincallbak && this.logincallbak();
      }else{
        callback && callback();
      }
    },
    ifMobile: function(data){ // 手机用户id单独处理
      if (data.os_type === "Android" || data.os_type === "ios") {
        data.ismobile = true;
        data.old_id = data.user_id;
        data.user_id *= 2.13;
      } else {
        data.ismobile = false;
      }
      return data;
    },
    parseData: function(data){
      if(!data)return false;
      try {
        if(!/^{.+}$/.test(data)) {
          data = data.match(/{.+}/g)[0];
        }
      }catch(e) {
        console.log(e);
      }
      if(typeof data === 'string'){
        data = JSON.parse(data);
      }
      return data;
    },
    assignEvent: function(method, data) { // 根据method判断数据类型
      if(!data || data.chat_type !== 1 || data.room_id !== this.room_id)return;  //聊天室类型，1聊天室2组聊3单聊 // 判断是否是当前room_id
      data = this.ifMobile(data);  // 手机用户id单独处理
      if(this.eventsArr.indexOf(method) != -1){//判断是否绑定了method名对应的事件，未绑定则不执行任何操作
        $(this).trigger(method, data);
      }
    },
    bindWsEvent: function(config){
      var that = this;
      if(!config || typeof config !== 'object'){
        console.warn('事件对象有误，事件绑定失败');
        return false;
      }
      Object.keys(config).forEach(function(v){
        that.eventsArr.push(v);
        $(that).off(v).on(v, config[v]);
      });
    },
  });

  return WSChat;
}));
