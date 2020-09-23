require("./constants.js");
require("./elements_data.js");

const Connection = require('./Connection');
const Services = require('./Services');
class DicomDimseServices {
  constructor(host, port) {
    this.HOST = host;
    this.PORT = port;
  }

  doEcho(config, callback) {

    const client = new Connection(this.HOST, this.PORT, {
      hostAE: config.hostAE || '',
      sourceAE: config.sourceAE || 'DICOMDIMSE'
    });

    client.connect(function () {
      const cEcho = new Services.CEcho();
      this.addService(cEcho);

      cEcho.doEcho([0, (result) => {
          if (result.error != null && result.error.code != null) {
              callback(result.error, false);
          } else {
              this.release();
              let dcmInfo = DicomDimseServices.parseDicomTags(result.elementPairs);
              callback(null, result.getStatus() == C.STATUS_SUCCESS, dcmInfo);
          }
      }]);
    });

    client.on('error', function (err) {
      client.destroy();
      callback(null, false, err);
    });
  }

  doFind(config, data, callback) {

    if (!config.qrLevel) {
      return callback(new Error('Invalid Argument: Query Level'));
    }

    if (!config.hostAE) {
      return callback(new Error('Invalid AE-Title'));
    }

    const client = new Connection(this.HOST, this.PORT, {
      hostAE: config.hostAE,
      sourceAE: config.sourceAE || 'DICOMDIMSE'
    });

    client.connect(function () {
      const cFind = new Services.CFind();
      this.addService(cFind);

      let results = [];

      cFind.retrieve(config.qrLevel, data, [(result) => {
        //studyIds.push(result.getValue(0x0020000D));
        results.push(DicomDimseServices.parseDicomTags(result.elementPairs));
      }, () => {
        this.release();
        callback(null, results);
      }]);
    });

    client.on('error', function (err) {
      client.destroy();
      callback(null, false, err);
    });
  }


    doStore(config, data, callback) {

        if (!config.qrLevel) {
            return callback(new Error('Invalid Argument: Query Level'));
        }

        if (!config.hostAE) {
            return callback(new Error('Invalid AE-Title'));
        }

        const client = new Connection(this.HOST, this.PORT, {
            hostAE: config.hostAE,
            sourceAE: config.sourceAE || 'DICOMDIMSE'
        });

        client.connect(function () {
            const
                cStore = new Services.CStore(null, C.SOP_MR_IMAGE_STORAGE),
                cFind = new Services.CFind(),
                cGet = new Services.CGet();
            cGet.setStoreService(cStore);

            this.addService(cFind);
            this.addService(cGet);
            this.addService(cStore);

            let studyIds = [];

            cFind.retrieveStudies({}, [function (result) {
                //console.log(result.toString());
                studyIds.push(result.getValue(0x0020000D));
            }, function () {
                let instances = [];
                cFind.retrieveInstances({0x0020000D: studyIds[0]}, [function (result) {
                    instances.push(result.getValue(0x00080018));
                }, function () {
                    cGet.retrieveInstance(instances[0], {}, [function (result) {
                        //console.log("c-get-rsp received");
                    }, function (cmd) {
                        this.release();
                    }, function (instance) {
                        console.log(instance.toString());

                        return C.STATUS_SUCCESS;
                    }]);
                }]);
            }]);
        });
    }

  static parseDicomTags(elementPairs) {
    let dcmRecord = {};

    for (let key in elementPairs) {
      let elementPair = elementPairs[key];
      
      if (!elementPair.tag || !elementPair.tag.value) {
        continue;
      }

      let hexTag = elementPair.tag.value.toString(16).padStart(8, '0');
      let dcmTagData = DicomElements.dicomNDict[elementPair.tag.value];

      dcmRecord[hexTag] = {
        tag: elementPair.tag.value,
        value: elementPair.value,
        vr: elementPair.vr,
        vm: elementPair.vm,
        implicit: elementPair.implicit,
        name: dcmTagData ? dcmTagData.keyword : ''
      }
    }

    return dcmRecord;
  }
}

module.exports = DicomDimseServices;
