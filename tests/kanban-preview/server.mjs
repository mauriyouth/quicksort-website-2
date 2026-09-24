// Development-only fixture server. No Clerk bypass is added to either portal.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../apps/admin/package.json', import.meta.url));
const { createServer } = require('vite');
const react = require('@vitejs/plugin-react');
const root = fileURLToPath(new URL('../..', import.meta.url));
const projects = ['Sales', 'Events', 'Marketing', 'Internal projects'].map((name,i) => ({ id: `p${i}`, name, created_at: new Date().toISOString() }));
const boards = [{ id: 'b0', project_id: 'p0', name: 'Sales decks' }, { id: 'b1', project_id: 'p1', name: 'Paris launch' }];
const columns = boards.flatMap(b => ['To do','In progress','Blocked','Done'].map((name,i) => ({ id: b.id + i, board_id:b.id, name, position:i })));
const state = {
  kanban_projects: projects, kanban_boards: boards, kanban_columns: columns,
  kanban_cards: [{ id:'c1', board_id:'b0', column_id:'b00', title:'Prepare the client presentation', description:'Bring together the proposal, timeline, and next steps.', created_by:'alex', creator_name:'Alex Morgan', created_at:new Date().toISOString() }],
  profiles:[{id:'alex',full_name:'Alex Morgan',email:'alex@example.invalid'},{id:'casey',full_name:'Casey Martin',email:'casey@example.invalid'}],
  kanban_project_members:[], kanban_board_members:[],
};
const server = await createServer({
  configFile: false, root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), { name:'kanban-fixtures', configureServer(server) {
    server.middlewares.use('/rest/v1', async (req,res,next) => {
      const url = new URL(req.url, 'http://localhost');
      const table = url.pathname.slice(1); if (!(table in state)) return next();
      let raw=''; for await (const part of req) raw+=part;
      const body = raw ? JSON.parse(raw) : {};
      let records = state[table];
      const matches = row => [...url.searchParams].filter(([,v]) => v.startsWith('eq.')).every(([k,v]) => row[k] === v.slice(3));
      if(req.method==='POST') {
        const row = {id:crypto.randomUUID(), created_at:new Date().toISOString(), ...body};
        if(table==='kanban_cards') Object.assign(row,{created_by:'alex',creator_name:'Alex Morgan'});
        records.push(row); records=[row];
        if(table==='kanban_boards') state.kanban_columns.push(...['To do','In progress','Blocked','Done'].map((name,i)=>({id:crypto.randomUUID(),board_id:row.id,name,position:i})));
      } else if(req.method==='PATCH') { records=records.filter(matches); records.forEach(r=>Object.assign(r,body)); }
      else if(req.method==='DELETE') { records=records.filter(matches); state[table]=state[table].filter(r=>!matches(r)); }
      else records=records.filter(matches).slice(Number(url.searchParams.get("offset") || 0), Number(url.searchParams.get("offset") || 0) + Number(url.searchParams.get("limit") || 1000));
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(req.headers.accept?.includes('object') ? records[0] : records));
    });
  }}],
  resolve: { alias: { 'react-dom': `${root}/apps/admin/node_modules/react-dom`, 'react': `${root}/apps/admin/node_modules/react` } },
  define: {'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:5176'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('fixture-only')},
  server:{host:'127.0.0.1',port:5176,strictPort:true,fs:{allow:[root]}},
});
await server.listen(); server.printUrls();
