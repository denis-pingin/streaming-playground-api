import dynamoDb from "./dynamodb-lib";
import * as uuid from "uuid";
import {generateOpenTokToken, startOpenTokSession} from "./opentok-lib";
import {websocketPubSub} from "../api/graphql/websockets";
import {POOL_CREATED, POOL_DELETED, POOL_UPDATED} from "../api/graphql/pool";

export async function getPools(tenantId = "default") {
  const params = {
    TableName: process.env.poolsTableName,
    KeyConditionExpression: "tenantId = :tenantId",
    ExpressionAttributeValues: {
      ":tenantId": tenantId
    }
  };

  const result = await dynamoDb.query(params);
  return result.Items;
}

export async function getPool(poolId) {
  let params = {
    TableName: process.env.poolsTableName,
    Key: {
      tenantId: "default",
      poolId: poolId
    }
  };

  const result = await dynamoDb.get(params);
  if (!result.Item) {
    throw new Error("Pool not found.");
  }

  return result.Item;
}

export async function getPoolForStreaming(userId, poolId) {
  // Get current pool
  const pool = await getPool(poolId);

  // Check if pool has OpenTok session
  if (!pool.openTokSessionConfig || !pool.openTokSessionConfig.sessionId) {
    throw new Error("OpenTok session not found in pool: " + pool);
  }

  pool.openTokSessionConfig.openTokToken = generateOpenTokToken(pool.openTokSessionConfig.sessionId);

  return pool;
}

export async function createPool(userId, name) {
  const openTokSessionConfig = await startOpenTokSession();
  console.log("OpenTok session config:", openTokSessionConfig);

  const params = {
    TableName: process.env.poolsTableName,
    Item: {
      tenantId: "default",
      poolId: uuid.v1(),
      name: name,
      ownerUserId: userId,
      openTokSessionConfig: openTokSessionConfig,
      updatedAt: Date.now(),
      createdAt: Date.now()
    }
  };

  await dynamoDb.put(params);
  const pool = params.Item;

  console.log("Created new pool:", pool);

  websocketPubSub.publish(POOL_CREATED, pool);

  return pool;
}

export async function updatePool(userId, poolId, name) {
  let pool = await getPool(poolId);
  if (pool.ownerUserId !== userId) {
    throw new Error("Permission denied");
  }

  const params = {
    TableName: process.env.poolsTableName,
    Key: {
      tenantId: "default",
      poolId: poolId
    },
    UpdateExpression: "SET #poolName = :name, updatedAt = :updatedAt",
    ExpressionAttributeNames: {
      "#poolName": "name"
    },
    ExpressionAttributeValues: {
      ":name": name || null,
      ":updatedAt": Date.now()
    },
    ReturnValues: "ALL_NEW"
  };

  const result = await dynamoDb.update(params);
  pool = result.Attributes;

  console.log("Updated pool:", pool);

  websocketPubSub.publish(POOL_UPDATED, pool);

  return pool;
}

export async function deletePool(userId, poolId) {
  const pool = await getPool(poolId);
  if (pool.ownerUserId !== userId) {
    throw new Error("Permission denied");
  }

  const params = {
    TableName: process.env.poolsTableName,
    Key: {
      tenantId: "default",
      poolId: poolId
    }
  };

  await dynamoDb.delete(params);

  console.log("Deleted pool:", pool);
  websocketPubSub.publish(POOL_DELETED, pool);

  return pool;
}
