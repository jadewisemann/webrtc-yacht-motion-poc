import Peer from 'peerjs';
import QRCode from 'qrcode';

const $ = id => document.getElementById(id);
const ids = ['roomId','hostButton','joinButton','connectionStatus','statusDot','connectionHelp','qrPanel','qrImage','qrUrl','roleLabel','rollsLeft','revisionLabel','diceBoard','rollButton','resetButton','gameMessage','eventLog','clearLog','motionPanel','motionPermission','simulateThrow','sensitivity','accelValue','rotationValue','energyValue','sampleRate','motionCanvas','throwTimeline','throwCount','lastThrowAt'];
const ui = Object.fromEntries(ids.map(id => [id,$(id)]));
const diceGlyphs = ['⚀','⚁','⚂','⚃','⚄','⚅'];
const presets = {
  gentle:{label:'부드럽게',energy:11,accel:9,rotation:75,cooldown:900},
  normal:{label:'보통',energy:18,accel:15,rotation:130,cooldown:1000},
  powerful:{label:'강하게',energy:28,accel:23,rotation:210,cooldown:1150},
};
const APP_VERSION='turn-relay-v2';
const peerConfig={
  iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun.cloudflare.com:3478'},
    {urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:80?transport=tcp',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turns:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'},
  ],
  iceCandidatePoolSize:10,
  iceTransportPolicy:'relay',
};

let role=null, peer=null, conn=null, room=null, motionEnabled=false, lastThrow=0, throwSequence=0;
let reconnectTimer=null, connectionAttempts=0;
let state={dice:[1,1,1,1,1],held:[false,false,false,false,false],rollsLeft:3,revision:0};
let samples=[], remoteSamples=[], sampleTimes=[], renderQueued=false, lastSampleSent=0;

function log(text,type='info') {
  const li=document.createElement('li'); li.dataset.type=type;
  const time=document.createElement('time'); time.textContent=new Date().toLocaleTimeString('ko-KR',{hour12:false,fractionalSecondDigits:3});
  li.append(time,text); ui.eventLog.prepend(li);
}

function setStatus(text,kind=''){ui.connectionStatus.textContent=text;ui.statusDot.className=`status-dot ${kind}`;}
function connected(){return conn?.open===true;}
function send(message){if(connected())conn.send(message);}

function renderGame(){
  ui.rollsLeft.textContent=state.rollsLeft; ui.revisionLabel.textContent=`rev. ${state.revision}`;
  ui.diceBoard.replaceChildren(...state.dice.map((value,index)=>{
    const button=document.createElement('button'); button.className=`die${state.held[index]?' held':''}`;
    button.disabled=!connected()||state.rollsLeft===3; button.innerHTML=`<span class="die-face">${diceGlyphs[value-1]}</span>`;
    button.addEventListener('click',()=>requestAction({type:'TOGGLE_HOLD',index})); return button;
  }));
  ui.rollButton.disabled=!connected()||state.rollsLeft===0; ui.resetButton.disabled=!connected();
}

function secureDie(){const max=Math.floor(0x100000000/6)*6,v=new Uint32Array(1);do crypto.getRandomValues(v);while(v[0]>=max);return v[0]%6+1;}
function requestAction(action){role==='host'?applyAction(action):send({type:'ACTION',action});}
function applyAction(action,throwMeta=null){
  if(action.type==='ROLL'&&state.rollsLeft>0){
    state={...state,dice:state.dice.map((v,i)=>state.held[i]?v:secureDie()),rollsLeft:state.rollsLeft-1,revision:state.revision+1};
    log(`ROLL → ${state.dice.join(' · ')}${throwMeta?` | energy ${throwMeta.energy.toFixed(1)}`:''}`,'throw');
    ui.gameMessage.textContent=state.rollsLeft?'주사위를 홀드하거나 다시 던지세요.':'이번 라운드가 끝났습니다.';
  }else if(action.type==='TOGGLE_HOLD'&&state.rollsLeft<3){const held=[...state.held];held[action.index]=!held[action.index];state={...state,held,revision:state.revision+1};}
  else if(action.type==='RESET'){state={dice:[1,1,1,1,1],held:[false,false,false,false,false],rollsLeft:3,revision:state.revision+1};ui.gameMessage.textContent='새 라운드입니다.';}
  else return;
  send({type:'STATE_SYNC',state}); renderGame();
}

function attachConnection(connection){
  if(conn&&conn!==connection){try{conn.close();}catch{}}
  conn=connection;
  const pc=connection.peerConnection;
  let relayCandidateSeen=false;
  if(pc){
    pc.addEventListener('icecandidate',event=>{if(!event.candidate)return;const type=event.candidate.type||event.candidate.candidate.match(/ typ (\w+)/)?.[1]||'unknown';const protocol=event.candidate.protocol||event.candidate.candidate.split(' ')[2]||'?';if(type==='relay')relayCandidateSeen=true;log(`ICE 후보: ${type} · ${protocol}`);});
    pc.addEventListener('icecandidateerror',event=>log(`TURN 오류 ${event.errorCode||''}: ${event.errorText||event.url||'candidate failed'}`,'error'));
    pc.addEventListener('iceconnectionstatechange',()=>{log(`ICE 상태: ${pc.iceConnectionState}`);if(pc.iceConnectionState==='failed')setStatus(relayCandidateSeen?'TURN 협상 실패':'TURN 후보 없음');});
    setTimeout(()=>{if(!connected()&&!relayCandidateSeen)log('TURN relay 후보를 아직 받지 못했습니다. 네트워크가 TURN 443을 차단할 수 있습니다.','error');},6000);
  }
  conn.on('open',()=>{clearTimeout(reconnectTimer);connectionAttempts=0;setStatus('P2P 연결됨','connected');ui.connectionHelp.textContent='모션과 게임 데이터가 WebRTC로 직접 전송됩니다.';log('DataChannel 연결 완료 (TURN fallback 활성)');if(role==='host')send({type:'STATE_SYNC',state});renderGame();});
  conn.on('data',message=>{
    if(role==='host'&&message.type==='ACTION')applyAction(message.action);
    if(role==='host'&&message.type==='MOTION')receiveMotion(message.sample);
    if(role==='host'&&message.type==='THROW')handleRemoteThrow(message.event);
    if(role==='guest'&&message.type==='STATE_SYNC'){state=message.state;renderGame();navigator.vibrate?.(35);}
  });
  conn.on('close',()=>{setStatus(role==='guest'?'PC 재연결 중':'컨트롤러 대기','connecting');renderGame();if(role==='guest')scheduleGuestRetry();});
  conn.on('error',error=>{log(`채널 오류: ${error.message}`,'error');if(role==='guest')scheduleGuestRetry();});
}

function createPeer(id){
  clearTimeout(reconnectTimer);peer?.destroy(); peer=new Peer(id,{debug:1,config:peerConfig});
  peer.on('error',error=>{setStatus(`연결 오류 · ${error.type}`);log(`${error.type}: ${error.message}`,'error');if(role==='guest'&&['webrtc','network','socket-error','server-error','peer-unavailable'].includes(error.type))scheduleGuestRetry();});
  peer.on('disconnected',()=>{setStatus('시그널링 재연결 중','connecting');log('PeerServer 연결 끊김 · 자동 재접속','error');reconnectTimer=setTimeout(()=>{if(peer&&!peer.destroyed&&peer.disconnected){try{peer.reconnect();}catch{}}},1200);});
  return peer;
}

function connectToHost(){
  if(role!=='guest'||!peer||peer.destroyed||peer.disconnected||connected())return;
  connectionAttempts++;
  setStatus(`PC 연결 시도 ${connectionAttempts}`,'connecting');
  log(`호스트 연결 시도 #${connectionAttempts}`);
  attachConnection(peer.connect(`yacht-motion-${room.toLowerCase()}`,{reliable:true,serialization:'json'}));
}

function scheduleGuestRetry(){
  if(role!=='guest'||connected())return;
  clearTimeout(reconnectTimer);
  reconnectTimer=setTimeout(()=>{if(peer?.disconnected){try{peer.reconnect();}catch{}}else connectToHost();},Math.min(1500+connectionAttempts*500,5000));
}

async function hostRoom(){
  room=ui.roomId.value.trim().toUpperCase(); if(!room)return;
  role='host';ui.roleLabel.textContent='PC 화면';document.body.classList.remove('controller-mode');setStatus('방 생성 중','connecting');
  const p=createPeer(`yacht-motion-${room.toLowerCase()}`);
  p.on('open',async()=>{setStatus('컨트롤러 대기','connecting');log(`방 생성: ${room} · ${APP_VERSION} · TURN relay 강제`);await showQr();});
  p.on('connection',attachConnection); ui.joinButton.disabled=true;ui.roomId.disabled=true;ui.motionPanel.hidden=false;
}

function joinRoom(){
  room=ui.roomId.value.trim().toUpperCase();if(!room)return;
  role='guest';ui.roleLabel.textContent='모션 컨트롤러';document.body.classList.add('controller-mode');setStatus('연결 중','connecting');
  const p=createPeer(); p.on('open',connectToHost);
  ui.hostButton.disabled=true;ui.roomId.disabled=true;ui.motionPanel.hidden=false;
}

function motionSample(event){
  const a=event.acceleration||event.accelerationIncludingGravity||{}; const r=event.rotationRate||{};
  processMotion({t:Date.now(),ax:a.x||0,ay:a.y||0,az:a.z||0,alpha:r.alpha||0,beta:r.beta||0,gamma:r.gamma||0,source:'sensor'});
}

function processMotion(sample){
  const accel=Math.hypot(sample.ax,sample.ay,sample.az); const rotation=Math.hypot(sample.alpha,sample.beta,sample.gamma);
  const previous=samples.at(-1); const jerk=previous?Math.abs(accel-previous.accel):0; const energy=accel+rotation*.045+jerk*.7;
  const enriched={...sample,accel,rotation,jerk,energy}; samples.push(enriched); if(samples.length>180)samples.shift();
  updateMetrics(enriched); scheduleChart(samples);
  if(role==='guest'&&connected()&&sample.t-lastSampleSent>45){send({type:'MOTION',sample:enriched});lastSampleSent=sample.t;}
  const preset=presets[ui.sensitivity.value];
  if(role==='guest'&&sample.t-lastThrow>preset.cooldown&&energy>=preset.energy&&(accel>=preset.accel||rotation>=preset.rotation)){
    lastThrow=sample.t;throwSequence++;const eventData={...enriched,id:throwSequence,preset:ui.sensitivity.value,threshold:preset.energy};
    send({type:'THROW',event:eventData});addThrowEvent(eventData,'local');navigator.vibrate?.([45,25,85]);
  }
}

function receiveMotion(sample){remoteSamples.push(sample);if(remoteSamples.length>180)remoteSamples.shift();updateMetrics(sample);scheduleChart(remoteSamples);}
function handleRemoteThrow(event){addThrowEvent(event,'remote');if(state.rollsLeft>0)applyAction({type:'ROLL'},event);}
function updateMetrics(s){ui.accelValue.textContent=s.accel.toFixed(1);ui.rotationValue.textContent=s.rotation.toFixed(0);ui.energyValue.textContent=s.energy.toFixed(1);sampleTimes.push(s.t);if(sampleTimes.length>20)sampleTimes.shift();if(sampleTimes.length>1)ui.sampleRate.textContent=Math.round((sampleTimes.length-1)*1000/(sampleTimes.at(-1)-sampleTimes[0]));}
function addThrowEvent(event,origin){
  const row=document.createElement('li'); const date=new Date(event.t);row.innerHTML=`<strong>#${event.id}</strong><time>${date.toLocaleTimeString('ko-KR',{hour12:false,fractionalSecondDigits:3})}</time><span>${presets[event.preset]?.label||event.preset}</span><b>${event.energy.toFixed(1)}</b><small>A ${event.accel.toFixed(1)} · R ${event.rotation.toFixed(0)} · J ${event.jerk.toFixed(1)}</small>`;
  ui.throwTimeline.prepend(row);ui.throwCount.textContent=String(Number(ui.throwCount.textContent)+1);ui.lastThrowAt.textContent=date.toLocaleTimeString('ko-KR',{hour12:false,fractionalSecondDigits:3});log(`THROW #${event.id} 감지 (${origin}) @ ${event.energy.toFixed(1)}`,'throw');
}

function scheduleChart(data){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{drawChart(data);renderQueued=false;});}
function drawChart(data){
  const canvas=ui.motionCanvas,ctx=canvas.getContext('2d'),dpr=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==w*dpr||canvas.height!==h*dpr){canvas.width=w*dpr;canvas.height=h*dpr;}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.strokeStyle='#2d354b';ctx.lineWidth=1;for(let y=0;y<=4;y++){ctx.beginPath();ctx.moveTo(0,y*h/4);ctx.lineTo(w,y*h/4);ctx.stroke();}
  const traces=[['accel','#62e6ac',40],['rotation','#8fa4ff',400],['energy','#ffb86b',45]];
  for(const [key,color,max] of traces){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();data.forEach((s,i)=>{const x=i/179*w,y=h-Math.min(s[key]/max,1)*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  const threshold=presets[ui.sensitivity.value].energy;ctx.strokeStyle='#ff667a';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(0,h-threshold/45*h);ctx.lineTo(w,h-threshold/45*h);ctx.stroke();ctx.setLineDash([]);
}

async function enableMotion(){
  try{if(typeof DeviceMotionEvent?.requestPermission==='function'){const result=await DeviceMotionEvent.requestPermission();if(result!=='granted')throw new Error('모션 권한이 거부됨');}
    window.addEventListener('devicemotion',motionSample);motionEnabled=true;ui.motionPermission.textContent='센서 활성화됨';ui.motionPermission.disabled=true;log('DeviceMotion 센서 활성화');
  }catch(error){log(error.message,'error');ui.gameMessage.textContent='브라우저 설정에서 모션 센서 권한을 허용하세요.';}
}
function simulate(){
  const now=Date.now(),power={gentle:14,normal:22,powerful:34}[ui.sensitivity.value];
  for(let i=0;i<18;i++)setTimeout(()=>processMotion({t:now+i*45,ax:(Math.random()-.5)*power,ay:(Math.random()-.5)*power,az:i===9?power:Math.random()*8,alpha:Math.random()*power*8,beta:Math.random()*power*5,gamma:Math.random()*power*6,source:'simulation'}),i*45);
}
async function showQr(){const target=`${location.origin}${location.pathname}?role=controller&room=${encodeURIComponent(room)}`;ui.qrImage.src=await QRCode.toDataURL(target,{width:320,margin:1});ui.qrUrl.textContent=target;ui.qrPanel.hidden=false;}

ui.hostButton.addEventListener('click',hostRoom);ui.joinButton.addEventListener('click',joinRoom);ui.rollButton.addEventListener('click',()=>requestAction({type:'ROLL'}));ui.resetButton.addEventListener('click',()=>requestAction({type:'RESET'}));ui.motionPermission.addEventListener('click',enableMotion);ui.simulateThrow.addEventListener('click',simulate);ui.clearLog.addEventListener('click',()=>ui.eventLog.replaceChildren());ui.sensitivity.addEventListener('change',()=>{log(`감도 변경: ${presets[ui.sensitivity.value].label}`);drawChart(role==='host'?remoteSamples:samples);});
const params=new URLSearchParams(location.search);if(params.get('room'))ui.roomId.value=params.get('room').toUpperCase();if(params.get('role')==='controller')setTimeout(joinRoom,0);renderGame();drawChart([]);
