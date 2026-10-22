import { ChessGame } from './rules.mjs';
/** Transaction generation invalidates every deferred AI/animation callback. */
export class GameState {
 constructor(game=new ChessGame()){this.game=game;this.generation=0;this.animation=null;this.aiEnabled=false;this.crew='strawhats';this.pendingAI=null;}
 get locked(){return this.animation!==null;}
 get version(){return this.game.version;}
 token(){return {generation:this.generation,version:this.game.version};}
 isCurrent(token){return !!token&&token.generation===this.generation&&token.version===this.game.version;}
 invalidate(){this.generation++;this.animation=null;this.pendingAI=null;return this.token();}
 move(request){if(this.locked)throw Error('Animation in progress');const record=this.game.move(request);this.generation++;this.pendingAI=null;return record;}
 beginAnimation(record){if(this.locked)throw Error('Animation in progress');const token=this.token();this.animation={record,token};return token;}
 finishAnimation(token){if(!this.isCurrent(token)||this.animation?.token!==token)return false;this.animation=null;return true;}
 reset(){this.invalidate();this.game.reset();return this.token();}
 undo(){this.invalidate();return this.game.undo();}
 setCrew(crew){this.crew=crew;return this.reset();}
 setAI(enabled){this.invalidate();this.aiEnabled=!!enabled;return this.token();}
 async queueAI(choose,{apply=true}={}){if(!this.aiEnabled||this.locked||this.game.status().over)return null;const token=this.token();const pending={token};this.pendingAI=pending;try{const move=await choose(this.game,token);if(!this.isCurrent(token)||!this.aiEnabled||this.locked||this.pendingAI!==pending)return null;this.pendingAI=null;return move&&apply?this.move(move):move;}catch(error){if(this.pendingAI===pending)this.pendingAI=null;if(this.isCurrent(token))throw error;return null;}}
}
