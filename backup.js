import express from 'express';
import Database from 'better-sqlite3';

const app = express();
const port = 3001;

app.use(express.json());
app.get('/', (req, res) => {
  return res.status(200).send({'message': 'SHIPTIVITY API. Read documentation to see API docs'});
});

// We are keeping one connection alive for the rest of the life application for simplicity
const db = new Database('./clients.db');

// Don't forget to close connection when server gets terminated
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Id can only be integer.',
      },
    };
  }
  const client = db.prepare('select * from clients where id = ? limit 1').get(id);
  if (!client) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Cannot find client with that id.',
      },
    };
  }
  return {
    valid: true,
  };
}

/**
 * Validate priority input
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if (Number.isNaN(priority)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid priority provided.',
      'long_message': 'Priority can only be positive integer.',
      },
    };
  }
  return {
    valid: true,
  }
}

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients, optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // status can only be either 'backlog' | 'in-progress' | 'complete'
    
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
    const clients = db.prepare('select * from clients where status = ?').all(status);
    return res.status(200).send(clients);
  }
  const statement = db.prepare('select * from clients');
  const clients = statement.all();
  return res.status(200).send(clients);
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }
  return res.status(200).send(db.prepare('select * from clients where id = ?').get(id));
});

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed
 * When priority is provided, the client priority will be changed with the rest of the clients accordingly
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No client on the same status should not have the same priority.
 * This API should return list of clients on success
 *
 * PUT /api/v1/clients/{client_id} - change the status of a client
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer,
 *
 */

/** 
 * setup Insomnia to accept JSON, 
 * {"priority": 10000}
 * and in header: 
 * Content-Type: application/json
 *
*/
app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }
  // console.log(req.body)
  let { status, priority } = req.body;

  // console.log(status, priority)

  // let clients = db.prepare('select * from clients').all();
  // const client = clients.find(client => client.id === id);

  /* ---------- Update code below ----------*/
  // 
  // scenarios:
  // status && priority: 
  // new status === client.status ---> no change in lane
  // new status !== client.status ---> change in lane
  // in client (old) lane, update priority >= client.prioriy by deducting 1, (ie move upwards, pull client out)
  // in new lane, update priority >= new prioity by adding 1 (move down to leave a spot to insert client)
  // lastly update the client to new status and priority

  // priority===null:
  // add client to end of lane. 
  // update priority to total number of client in new status lane.

  // status = null:
  // client stays in same lane.
  // update status to client current lane.

  // edge cases: 
  // priority > total number of clients in the lane, add client to end of lane
  // priority updated to total number of clients + 1

  // priority <= 0,  add client to front of lane
  // priority updated to 1

  // status === null  && priority===null, return client


  const client = db.prepare('select * from clients where id = ?').get(id)

  if(!status && !priority)
    return res.status(200).send(client);
  
  if(status){
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
  }
  else
  { // !status
      status = client.status
  }

  const newLaneClientsCount = db.prepare('select count(id) as count from clients where status = ?').all(status)[0].count
  if(!priority){
    if(status !== client.status)
      priority = newLaneClientsCount + 1
    else
      return res.status(200).send(client);
  }
  else 
  {
      if(priority <= 0)
        priority = 1

      else if(priority > newLaneClientsCount){
        if(status === client.status) // already in lane, move to last
          priority = newLaneClientsCount
        else
          priority = newLaneClientsCount+1
      }  
  }
  



    // update the priority of the old lane
    const oldLaneClients = db.prepare('select id, priority from clients where status = ? and priority >= ?').all(client.status, client.priority);
    for(let olc of oldLaneClients){
      const update = db.prepare('UPDATE clients SET priority = ? WHERE id = ?');
      const result = update.run(olc.priority-1, olc.id);
    } 

    // update the priority of the new lane
    const newLaneClients = db.prepare('select id, priority from clients where status = ? and priority >= ?').all(status, priority);
    for(let nlc of newLaneClients){
      const update = db.prepare('UPDATE clients SET priority = ? WHERE id = ?');
      const result = update.run(nlc.priority+1, nlc.id);
    }

  
    // update the status and priority of the client
    const update = db.prepare('UPDATE clients SET status = ?, priority = ? WHERE id = ?');
    const result = update.run(status, priority, id);
  



  return res.status(200).send(db.prepare('select * from clients where id = ?').get(id));
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});