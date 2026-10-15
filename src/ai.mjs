import { ChessGame } from './rules.mjs';
const VALUE={pawn:100,knight:320,bishop:330,rook:500,queen:900,king:0};
export function chooseMove(game,{depth=2,maxNodes=3000}={}){
 if(game.status().over)return null;
 const limit=Math.max(1,Math.min(100000,Number.isFinite(maxNodes)?Math.floor(maxNodes):3000));
 const horizon=Math.max(1,Math.min(4,Number.isFinite(depth)?Math.floor(depth):2));
 const clone=new ChessGame(game.fen());const side=game.turn;let nodes=0;
 const evaluate=()=>clone.board.flat().reduce((n,p)=>n+(p?(p.player===side?1:-1)*VALUE[p.type]:0),0);
 const search=(remaining,alpha,beta)=>{nodes++;const legal=clone._legal();if(!legal.length)return clone.inCheck()?(clone.turn===side?-100000:100000):0;if(!remaining||nodes>=limit)return evaluate();const maximize=clone.turn===side;let best=maximize?-Infinity:Infinity;for(const move of legal){if(nodes>=limit)break;const snapshot=clone._snapshot();clone._apply(move);const score=search(remaining-1,alpha,beta);clone._restore(snapshot);best=maximize?Math.max(best,score):Math.min(best,score);if(maximize)alpha=Math.max(alpha,best);else beta=Math.min(beta,best);if(beta<=alpha)break;}return Number.isFinite(best)?best:evaluate();};
 let best=null,score=-Infinity;for(const move of clone._legal()){if(best&&nodes>=limit)break;const snapshot=clone._snapshot();clone._apply(move);const value=search(horizon-1,-Infinity,Infinity);clone._restore(snapshot);if(value>score){score=value;best=move;}}return best;
}
export const selectAIMove=chooseMove;
