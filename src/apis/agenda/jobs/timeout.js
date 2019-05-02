const jobNames = require('../jobNames');
const {
    COLLECTIONS_NAME
} = require('../../../util/constants');
const {
    updateMany
} = require('../../../util/db');
const config = require('../../../config');
const logger = require('../../../util/logger');

module.exports = function (agenda) {
    agenda.define(jobNames.timeoutIntelligence, async (job, done) => {
        try{
            let timeoutValue = Date.now() - config.TIMEOUT_VALUE_FOR_INTELLIGENCE;
            let runningStatus = "RUNNING";
            let configuredStatus = "TIMEOUT";
            await updateMany(COLLECTIONS_NAME.intelligences, {
                started_at: {
                    $lt: timeoutValue
                },
                status: {
                    $eq: runningStatus
                }
            }, {
                $set: {
                    status: configuredStatus
                }
            })

            done();
        }catch(err){
            logger.error(err);
        }
    });
};