const {neon}=require('../api/lib/neon.cjs');
const statements=[
 'CREATE SCHEMA IF NOT EXISTS epic_chess',
 `CREATE TABLE IF NOT EXISTS epic_chess.rooms (id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{24}$'),owner text NOT NULL,slot integer NOT NULL CHECK(slot>=0 AND slot<5),expires_at timestamptz NOT NULL,document jsonb NOT NULL,UNIQUE(owner,slot))`,
 'CREATE INDEX IF NOT EXISTS rooms_expiry_idx ON epic_chess.rooms(expires_at)'
];
async function setupRooms(env=process.env,request=fetch){for(const statement of statements)await neon(env,statement,[],request);}
if(require.main===module)setupRooms().then(()=>console.log('EPIC_CHESS_ROOMS_SCHEMA_READY')).catch(()=>{console.error('Rooms schema setup failed');process.exitCode=1;});
module.exports={setupRooms,statements};
