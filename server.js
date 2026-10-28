const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const PORT = Number(process.env.PORT || 3000);
const DATA = path.join(__dirname, 'local-data.json');
const sessions = new Map();
const rooms = new Map();
let users = [];
try { users = JSON.parse(fs.readFileSync(DATA, 'utf8')).users || []; } catch {}
const questions = [
 {q:'Which planet is known as the Red Planet?', options:['Venus','Mars','Jupiter','Mercury'], a:1},
 {q:'How many sides does a hexagon have?', options:['Five','Six','Seven','Eight'], a:1},
 {q:'Which ocean is the largest?', options:['Atlantic','Indian','Arctic','Pacific'], a:3},
 {q:'What is the chemical symbol for gold?', options:['Ag','Gd','Au','Go'], a:2},
 {q:'Which animal is famous for its black-and-white stripes?', options:['Zebra','Tiger','Panda','Skunk'], a:0},
 {q:'How many minutes are in two hours?', options:['100','110','120','140'], a:2},
 {q:'Which shape has three sides?', options:['Square','Triangle','Circle','Rectangle'], a:1}
];
const safe = s => String(s ?? '').trim().slice(0, 80);
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') });
const token = () => crypto.randomBytes(24).toString('hex');
function persistUsers(){ fs.writeFileSync(DATA, JSON.stringify({users}, null, 2)); }
function json(res, status, data){ res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }
function body(req){ return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6) req.destroy();});req.on('end',()=>{try{resolve(s?JSON.parse(s):{});}catch(e){reject(e);}});}); }
function playerFor(req){ const h=req.headers.authorization||''; const t=h.startsWith('Bearer ')?h.slice(7):''; return sessions.get(t); }
function makeRoom(host){ let code; do { code=crypto.randomBytes(3).toString('hex').toUpperCase(); } while(rooms.has(code)); const room={code, hostId:host.id, status:'lobby', phase:'lobby', round:0, challenge:0, players:[host], answers:{}, votes:{}, startedAt:0, deadline:0, message:'Waiting for players to join.'}; rooms.set(code,room); return room; }
function publicRoom(r, viewerId){
 const now=Date.now();
 if(r.status==='playing' && r.deadline && now>=r.deadline) advanceTimeout(r);
 const phaseData={};
 if(r.phase==='quiz') { const q=questions[(r.challenge)%questions.length]; phaseData.question=q.q; phaseData.options=q.options; phaseData.questionNo=r.challenge+1; phaseData.total=3; phaseData.timeLeft=Math.max(0,Math.ceil((r.deadline-now)/1000)); phaseData.answered=!!r.answers[viewerId]; }
 if(r.phase==='bluff') { phaseData.question=['Which animal has fingerprints surprisingly similar to humans?','Which fruit is botanically a berry: banana or strawberry?','What is the only mammal capable of true flight?'][r.challenge%3]; phaseData.stage=r.bluffStage||'submit'; phaseData.timeLeft=Math.max(0,Math.ceil((r.deadline-now)/1000)); phaseData.submitted=!!r.answers[viewerId]; phaseData.options=(r.bluffOptions||[]).map(o=>({id:o.id,text:o.text,owner:o.owner===viewerId?'You':(r.players.find(p=>p.id===o.owner)?.name||'Player')})); if(r.bluffStage==='vote') phaseData.options.push({id:'truth',text:['A koala','A banana','A bat'][r.challenge%3],owner:'Official answer'}); phaseData.voted=!!r.votes[viewerId]; }
 if(r.phase==='reaction'){ phaseData.challengeText=r.reactionText||'Tap the button when you are ready!'; phaseData.timeLeft=Math.max(0,Math.ceil((r.deadline-now)/1000)); phaseData.tapped=!!r.answers[viewerId]; }
 return {code:r.code,status:r.status,phase:r.phase,round:r.round,challenge:r.challenge,hostId:r.hostId,viewerId,players:r.players.map(p=>({id:p.id,name:p.name,guest:p.guest,ready:!!p.ready,score:p.score,online:true})),phaseData,leaderboard:[...r.players].sort((a,b)=>b.score-a.score).map((p,i)=>({rank:i+1,name:p.name,score:p.score})),message:r.message,winner:r.winner||null,canStart:r.players.length>=2&&r.players.every(p=>p.ready),isHost:r.hostId===viewerId};
}
function nextPhase(r){
 if(r.phase==='quiz' && r.challenge<2){r.challenge++;r.answers={};r.deadline=Date.now()+18000;r.message='Next quiz question!';return;}
 if(r.phase==='quiz'){r.phase='bluff';r.challenge=0;r.answers={};r.votes={};r.bluffStage='submit';r.bluffOptions=[];r.deadline=Date.now()+25000;r.message='Bluff Battle: submit a funny believable answer.';return;}
 if(r.phase==='bluff' && r.bluffStage==='submit'){r.bluffStage='vote';r.votes={};r.deadline=Date.now()+15000;r.message='Vote for the answer you believe!';return;}
 if(r.phase==='bluff' && r.bluffStage==='vote' && r.challenge<2){r.challenge++;r.answers={};r.votes={};r.bluffOptions=[];r.bluffStage='submit';r.deadline=Date.now()+25000;r.message='Next bluff challenge!';return;}
 if(r.phase==='bluff'){r.phase='reaction';r.challenge=0;r.answers={};r.deadline=Date.now()+12000;r.reactionText='Tap the button as quickly as you can!';r.message='Reaction Rush starts now!';return;}
 if(r.phase==='reaction' && r.challenge<2){r.challenge++;r.answers={};r.deadline=Date.now()+12000;r.message='Next reaction challenge!';return;}
 r.phase='results';r.status='finished';r.deadline=0;r.winner=[...r.players].sort((a,b)=>b.score-a.score)[0]?.name||'No winner';for(const p of r.players){if(p.accountId){const a=users.find(x=>x.id===p.accountId);if(a){a.games++;a.totalScore+=p.score;if(p.name===r.winner)a.wins++;}}}if(r.players.some(p=>p.accountId))persistUsers();r.message=`${r.winner} wins Triple Threat!`;
}
function advanceTimeout(r){ if(r.phase==='bluff'&&r.bluffStage==='submit'){ if(r.bluffOptions.length<2){ for(const p of r.players){if(!r.bluffOptions.some(o=>o.owner===p.id))r.bluffOptions.push({id:token().slice(0,8),owner:p.id,text:'I choose the mysterious option!'})} } r.bluffStage='vote';r.votes={};r.deadline=Date.now()+12000;r.message='Time to vote!';return; } if(r.phase==='bluff'&&r.bluffStage==='vote'){nextPhase(r);return;} nextPhase(r); }
function startGame(r){r.status='playing';r.phase='quiz';r.round=1;r.challenge=0;r.answers={};r.votes={};r.deadline=Date.now()+18000;r.message='Quiz Battle: choose the correct answer!';}
function allAnswered(r){return r.players.every(p=>r.answers[p.id]!==undefined);}
function allVoted(r){return r.players.every(p=>r.votes[p.id]!==undefined);}
async function route(req,res){
 const u=new URL(req.url,`http://${req.headers.host||'localhost'}`); const p=u.pathname;
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end();}
 if(req.method==='GET' && p==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'public','index.html')));}
 if(req.method==='GET' && p==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'public','app.js')));}
 if(req.method==='GET' && p==='/style.css'){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'public','style.css')));}
 try {
 if(req.method==='POST' && p==='/api/guest'){const b=await body(req), name=safe(b.name);if(name.length<2)return json(res,400,{error:'Choose a name with at least 2 characters.'});const user={id:token(),name,guest:true,score:0,ready:false};const t=token();sessions.set(t,user);return json(res,200,{token:t,user:{id:user.id,name:user.name,guest:true}});}
 if(req.method==='POST' && p==='/api/register'){const b=await body(req),name=safe(b.username),email=safe(b.email).toLowerCase(),pw=String(b.password||'');if(name.length<3||!email.includes('@')||pw.length<8)return json(res,400,{error:'Use a username (3+ characters), valid email, and password (8+ characters).'});if(users.some(x=>x.username.toLowerCase()===name.toLowerCase()||x.email===email))return json(res,409,{error:'That username or email is already registered.'});const hp=hashPassword(pw);const account={id:token(),username:name,email,...hp,wins:0,games:0,totalScore:0};users.push(account);persistUsers();const user={id:account.id,name,guest:false,accountId:account.id,score:0,ready:false};const t=token();sessions.set(t,user);return json(res,200,{token:t,user:{id:user.id,name,guest:false}});}
 if(req.method==='POST' && p==='/api/login'){const b=await body(req),login=safe(b.login).toLowerCase(),pw=String(b.password||'');const a=users.find(x=>x.username.toLowerCase()===login||x.email===login);if(!a||hashPassword(pw,a.salt).hash!==a.hash)return json(res,401,{error:'Incorrect username/email or password.'});const user={id:a.id,name:a.username,guest:false,accountId:a.id,score:0,ready:false};const t=token();sessions.set(t,user);return json(res,200,{token:t,user:{id:user.id,name:user.name,guest:false}});}
 const me=playerFor(req);
 if(p==='/api/me'&&req.method==='GET'){if(!me)return json(res,401,{error:'Please sign in again.'});const a=me.accountId?users.find(x=>x.id===me.accountId):null;return json(res,200,{user:{id:me.id,name:me.name,guest:me.guest,stats:a?{wins:a.wins,games:a.games,totalScore:a.totalScore}:null}});}
 if(!me)return json(res,401,{error:'Please choose Guest Mode or sign in.'});
 if(req.method==='POST'&&p==='/api/rooms'){const room=makeRoom({...me,ready:true,score:0});return json(res,200,{room:publicRoom(room,me.id)});}
 if(req.method==='POST'&&p==='/api/join'){const b=await body(req),code=safe(b.code).toUpperCase(),r=rooms.get(code);if(!r)return json(res,404,{error:'Room not found. Check the code.'});if(r.status!=='lobby')return json(res,400,{error:'This match has already started.'});if(r.players.length>=8)return json(res,400,{error:'This room is full (8 players max).'});if(r.players.some(x=>x.id===me.id))return json(res,200,{room:publicRoom(r,me.id)});r.players.push({...me,ready:false,score:0});r.message=`${me.name} joined the room.`;return json(res,200,{room:publicRoom(r,me.id)});}
 const rm=p.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(action))?$/);
 if(rm&&req.method==='GET'){const r=rooms.get(rm[1]);if(!r)return json(res,404,{error:'Room not found.'});if(!r.players.some(x=>x.id===me.id))return json(res,403,{error:'You are not in this room.'});return json(res,200,{room:publicRoom(r,me.id)});}
 if(rm&&rm[2]==='action'&&req.method==='POST'){const r=rooms.get(rm[1]);if(!r)return json(res,404,{error:'Room not found.'});const player=r.players.find(x=>x.id===me.id);if(!player)return json(res,403,{error:'You are not in this room.'});const b=await body(req);if(b.type==='ready'){player.ready=!!b.value;r.message=`${player.name} ${player.ready?'is ready':'is not ready'}.`;}
 else if(b.type==='start'){if(r.hostId!==me.id)return json(res,403,{error:'Only the host can start.'});if(r.players.length<2)return json(res,400,{error:'You need at least 2 players.'});if(!r.players.every(x=>x.ready))return json(res,400,{error:'Everyone must be ready first.'});startGame(r);}
 else if(b.type==='answer'&&r.phase==='quiz'){if(r.answers[me.id]===undefined){r.answers[me.id]=Number(b.value);if(Number(b.value)===questions[r.challenge%questions.length].a){const elapsed=Math.max(0,18000-(r.deadline-Date.now()));player.score+=100+Math.max(0,Math.round(50*(1-elapsed/18000)));}if(allAnswered(r))nextPhase(r);}}
 else if(b.type==='bluff'&&r.phase==='bluff'&&r.bluffStage==='submit'){const text=safe(b.value);if(text.length<2)return json(res,400,{error:'Write at least 2 characters.'});if(!r.answers[me.id]){r.answers[me.id]=true;r.bluffOptions.push({id:token().slice(0,8),owner:me.id,text});if(r.players.every(x=>r.answers[x.id]))nextPhase(r);}}
 else if(b.type==='vote'&&r.phase==='bluff'&&r.bluffStage==='vote'){if(r.votes[me.id]===undefined){r.votes[me.id]=safe(b.value);const picked=r.bluffOptions.find(o=>o.id===b.value);if(b.value==='truth'){player.score+=100;}else if(picked&&picked.owner!==me.id){const owner=r.players.find(x=>x.id===picked.owner);if(owner)owner.score+=100;player.score+=50;}if(allVoted(r))nextPhase(r);}}
 else if(b.type==='tap'&&r.phase==='reaction'){if(r.answers[me.id]===undefined){const rank=Object.keys(r.answers).length;player.score += rank===0?100:rank===1?75:rank===2?50:25;r.answers[me.id]=Date.now();if(allAnswered(r))nextPhase(r);}}
 else if(b.type==='rematch'&&r.status==='finished'){if(r.hostId!==me.id)return json(res,403,{error:'Only the host can start a rematch.'});r.players.forEach(x=>{x.score=0;x.ready=x.id===me.id;});r.status='lobby';r.phase='lobby';r.round=0;r.challenge=0;r.answers={};r.votes={};r.bluffOptions=[];r.message='Rematch lobby. Everyone ready up!';r.winner=null;}
 else return json(res,400,{error:'That action is not available right now.'});return json(res,200,{room:publicRoom(r,me.id)});}
 if(p==='/api/leaderboard'&&req.method==='GET'){return json(res,200,{leaders:users.slice().sort((a,b)=>b.wins-a.wins||b.totalScore-a.totalScore).slice(0,20).map(a=>({name:a.username,wins:a.wins,games:a.games,totalScore:a.totalScore}))});}
 return json(res,404,{error:'Not found.'});
 } catch(e){console.error(e);return json(res,500,{error:'Server error.'});}
}
const server=http.createServer((req,res)=>route(req,res));
setInterval(()=>{for(const r of rooms.values()){if(r.status==='playing'&&r.deadline&&Date.now()>=r.deadline)advanceTimeout(r);}},250);
server.listen(PORT,'0.0.0.0',()=>console.log(`Triple Threat running at http://localhost:${PORT}`));
