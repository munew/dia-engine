const _ = require("lodash");
const uuidv4 = require("uuid/v4");
// const axios = require("axios");
const semver = require("semver");
const {
  CONFIG,
  COLLECTIONS_NAME,
  AGENT_STATE,
  DEFAULT_AGENT
} = require("../../util/constants");
const { HTTPError } = require("../../util/error");
const {
  find,
  insertOne,
  updateOne,
  updateMany,
  remove
} = require("../../util/db");
import {
  addAgentDB,
  getAgentsDB,
  getAgentByGlobalIdDB,
  updateAgentDB,
  deleteAgentDB
} from "../../dbController/Agent.ctrl";
const {
  validateAgentAndUpdateState,
  generateGlobalId
} = require("../../util/utils");
// const config = require("../../config");
// const logger = require("../../util/logger");

/**
 * Check an agent exist or not, if exist return this agent
 * @param {string} gid - Agent global ID
 * @param {string} securityKey - request security key if passed
 * @returns {Object} - agent
 */
async function checkAgentExistByGlobalID(gid, securityKey) {
  try {
    let agent = await getAgentByGlobalIdDB(gid, securityKey);
    // agent doesn't exist
    if (!agent) {
      throw new HTTPError(
        404,
        null,
        { globalId: gid },
        "00004040002",
        gid,
        securityKey
      );
    }
    return agent;
  } catch (err) {
    throw err;
  }
}

/**
 * Register an Agent to DIA.
 * Follow KISS principle, you need to make sure your **globalId** is unique.
 * Currently, **globalId** is only way for **Agent** Identity.
 * @param {object} Agent - Agent need to be register
 * @param {string} securityKey - The securityKey that previous service send, used to identify who send this request
 *
 * @returns {object}
 */
async function registerAgent(agent, securityKey) {
  try {
    // validate agent
    // TODO: change to validate based on schema
    if (!_.get(agent, "name")) {
      throw new HTTPError(400, null, {}, "00134000001");
    }

    // TODO: Think about whether we need to support Dynamic Generate **globalId**.
    // Comment 07/12/2019: after several time thinking, I think we should automatically generate **globalId**, so I comment this code.
    // Use globalId to find Agent.
    // let agentInDB = await findOneByGlobalId(
    //   COLLECTIONS_NAME.agents,
    //   agent.globalId,
    //   {
    //     projection: {
    //       globalId: 1
    //     }
    //   }
    // );
    // // globalId must be unique
    // if (agentInDB) {
    //   // globalId already exist
    //   throw new HTTPError(
    //     400,
    //     null,
    //     {
    //       globalId: agent.globalId
    //     },
    //     "00134000001",
    //     agent.globalId
    //   );
    // }

    // Delete globalId and _id, both of them should be generated by server side, don't allow user pass
    delete agent.globalId;
    delete agent._id;
    agent.globalId = generateGlobalId("agent");
    agent.type = _.toUpper(agent.type);
    // Before validate, default set agent state to DRAFT
    // agent.state = AGENT_STATE.draft;
    // when create an agent, default version is 1.0.0, the reason of 1.0.0 is because currently Agent Schema version is 1.0.0, make sure the main version is same with schema
    // agent.version = '1.0.0';
    agent = _.merge({}, DEFAULT_AGENT, agent);

    // if securityKey exist, then add securityKey to agent
    if (securityKey) {
      agent.system[CONFIG.SECURITY_KEY_IN_DB] = securityKey;
    }
    agent.system.created = Date.now();
    agent.system.modified = Date.now();
    agent.system.lastPing = null;
    // Validate agent, based on validate result to update agent state, don't allow user to direct change agent state
    agent = validateAgentAndUpdateState(agent);
    let result = await addAgentDB(agent);
    return result;
  } catch (err) {
    // Already HTTPError, then throw it
    throw err;
  }
}

/**
 * OperationIndex: 0002
 * Get a Agent by globalId
 * @param {string} gid - globalId
 *
 * @returns {object}
 */
async function getAgent(gid: string, securityKey: string) {
  try {
    if (!gid) {
      throw new HTTPError(
        400,
        null,
        {
          globalId: gid
        },
        "00024000001"
      );
    }
    let agent = await getAgentByGlobalIdDB(gid, securityKey);
    if (!agent) {
      throw new HTTPError(
        404,
        null,
        {
          globalId: gid
        },
        "00024040001",
        gid
      );
    }
    return agent;
  } catch (err) {
    throw err;
  }
}

/**
 * OperationIndex: 0010
 * Get a Agents
 * @param {string} securityKey - current user's security key
 *
 * @returns {object}
 */
async function getAgents(securityKey) {
  try {
    let agents = await getAgentsDB(securityKey);
    return agents;
  } catch (err) {
    throw err;
  }
}

async function updateAgent(gid, agent, securityKey) {
  try {
    // Make sure can find Agent, if cannot, the it will throw 404 error
    let originalAgent = await checkAgentExistByGlobalID(gid, securityKey);

    // Remove cannot update fields
    delete agent._id;
    delete agent.id;
    delete agent.globalId;
    if (agent.system) {
      delete agent.system.created;
    }

    // let originalAgent = await getAgent(gid, securityKey);
    let obj = _.merge({}, originalAgent, agent);
    obj.system.modified = Date.now();

    // state before validation
    let agentState = obj.system.state;
    // Validate agent, based on validate result to update agent state, don't allow user to direct change agent state
    obj = validateAgentAndUpdateState(obj);

    // if agent state is **active** or **deleted**, then return error
    if (
      _.toUpper(obj.system.state) === _.toUpper(AGENT_STATE.active) ||
      _.toUpper(obj.system.state) === _.toUpper(AGENT_STATE.deleted)
    ) {
      throw new HTTPError(
        400,
        null,
        { globalId: obj.globalId, state: obj.system.state, name: obj.name },
        "00015400001",
        obj.system.state,
        obj.globalId
      );
    }

    // if state change, then we need to update minor version, otherwise only need to update patch version
    if (agentState !== obj.system.state) {
      // this means state change, then need to update minor
      obj.system.version = semver.inc(obj.system.version || "1.0.0", "minor");
    } else {
      obj.system.version = semver.inc(obj.system.version || "1.0.0", "patch");
    }

    // let result = await updateOne(
    //   COLLECTIONS_NAME.agents,
    //   {
    //     globalId: {
    //       $eq: gid
    //     }
    //   },
    //   {
    //     $set: obj
    //   }
    // );
    // return result;

    let result = await updateAgentDB(gid, securityKey, obj);
    return result;
  } catch (err) {
    throw err;
  }
}

/**
 * Activate an agent
 * 0017
 * @param {string} gid - agent globalId
 * @param {string} securityKey - current user's security key
 */
async function activateAgent(gid, securityKey) {
  try {
    let originalAgent: any = await checkAgentExistByGlobalID(gid, securityKey);
    originalAgent = validateAgentAndUpdateState(originalAgent);

    // if it is draft state then throw an error
    if (originalAgent.system.state === AGENT_STATE.draft) {
      throw new HTTPError(400, null, { globalId: gid }, "0017400001");
    } else if (originalAgent.system.state === AGENT_STATE.deleted) {
      // **delete** then tell user cannot find, since we didn't show deleted agent in user's agent list
      throw new HTTPError(
        404,
        null,
        { globalId: gid },
        "00004040001",
        gid,
        securityKey
      );
    } else if (originalAgent.system.state === AGENT_STATE.active) {
      // If an agent's state is active, don't need to update it again
      return {
        state: originalAgent.system.state
      };
    }

    // change state to **active**
    originalAgent.system.state = _.toUpper(AGENT_STATE.active);
    originalAgent.system.version = semver.inc(
      originalAgent.system.version || "1.0.0",
      "minor"
    );
    let result = await updateOne(
      COLLECTIONS_NAME.agents,
      {
        globalId: {
          $eq: gid
        }
      },
      {
        $set: originalAgent
      }
    );
    return {
      state: originalAgent.system.state
    };
  } catch (err) {
    throw err;
  }
}

/**
 * Deactivate an agent
 * @param {string} gid
 * @param {string} securityKey
 */
async function deactivateAgent(gid, securityKey) {
  try {
    let originalAgent: any = await checkAgentExistByGlobalID(gid, securityKey);
    // originalAgent = validateAgentAndUpdateState(originalAgent);

    // if it is draft state then throw an error
    if (originalAgent.system.state === AGENT_STATE.draft) {
      throw new HTTPError(400, null, { globalId: gid }, "0018400001");
    } else if (originalAgent.system.state === AGENT_STATE.deleted) {
      // **delete** then tell user cannot find, since we didn't show deleted agent in user's agent list
      throw new HTTPError(
        404,
        null,
        { globalId: gid },
        "00004040001",
        gid,
        securityKey
      );
    } else if (originalAgent.system.state != AGENT_STATE.active) {
      // If an agent's state isn't active, don't need to update it again
      return {
        state: originalAgent.system.state
      };
    }

    // change state to **configured**
    originalAgent.system.state = _.toUpper(AGENT_STATE.configured);
    originalAgent.system.version = semver.inc(
      originalAgent.system.version || "1.0.0",
      "minor"
    );
    let result = await updateOne(
      COLLECTIONS_NAME.agents,
      {
        globalId: {
          $eq: gid
        }
      },
      {
        $set: originalAgent
      }
    );
    return {
      state: originalAgent.system.state
    };
  } catch (err) {
    throw err;
  }
}

async function unregisterAgent(gid:string, securityKey:string) {
  try {
    console.log('gid: ', gid, ' securityKey: ', securityKey);
    // Make sure can find Agent, if cannot, the it will throw 404 error
    await checkAgentExistByGlobalID(gid, securityKey);
    let result = await deleteAgentDB(gid, securityKey);
    return result;
    // let query = {
    //   "agent.globalId": {
    //     $eq: gid
    //   }
    // };

    // // if (securityKey) {
    // //   query[CONFIG.SECURITY_KEY_IN_DB] = {
    // //     $eq: securityKey
    // //   };
    // // }
    // // remove all intelligences that this agent created
    // await remove(COLLECTIONS_NAME.intelligences, {
    //   query
    // });

    // let agentQuery = {
    //   globalId: {
    //     $eq: gid
    //   }
    // };
    // if (securityKey) {
    //   agentQuery[`system.${CONFIG.SECURITY_KEY_IN_DB}`] = {
    //     $eq: securityKey
    //   };
    // }

    // // remove this Agent in agents collection
    // let result = await remove(COLLECTIONS_NAME.agents, agentQuery);
    // return result;

  } catch (err) {
    throw err;
  }
}

module.exports = {
  registerAgent,
  getAgent,
  updateAgent,
  unregisterAgent,
  activateAgent,
  deactivateAgent,
  getAgents
};
