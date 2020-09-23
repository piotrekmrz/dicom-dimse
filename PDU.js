const {WriteStream} = require('./RWStream');
const F = require('./Field');
const {readMessage} = require('./Message');

class PDU {
  constructor() {
    this.fields = [];
    this.lengthBytes = 4;
  }

  length(fields) {
    let len = 0;
    for (let f of fields) {
      len += !f.getFields ? f.length() : f.length(f.getFields());
    }
    return len;
  }

  is(type) {
    return this.type == type;
  }

  getFields(fields) {
    let len = this.lengthField(fields);
    fields.unshift(len);
    if (this.type !== null) {
      fields.unshift(new F.ReservedField());
      fields.unshift(new F.HexField(this.type));
    }

    return fields;
  }

  lengthField(fields) {
    if (this.lengthBytes == 4) {
      return new F.UInt32Field(this.length(fields));
    } else if (this.lengthBytes == 2) {
      return new F.UInt16Field(this.length(fields));
    } else {
      throw "Invalid length bytes";
    }
  }

  read(stream) {
    stream.read(C.TYPE_HEX, 1);
    let length = stream.read(C.TYPE_UINT32);
    this.readBytes(stream, length);
  }

  load(stream) {
    return pduByStream(stream);
  }

  loadPDV(stream, length) {
    if (stream.end()) return false;
    let bytesRead = 0,
      pdvs = [];
    while (bytesRead < length) {
      let plength = stream.read(C.TYPE_UINT32),
        pdv = new PresentationDataValueItem();
      pdv.readBytes(stream, plength);
      bytesRead += plength + 4;

      pdvs.push(pdv);
    }

    return pdvs;
  }

  loadDicomMessage(stream, isCommand, isLast) {
    let message = readMessage(stream, isCommand, isLast);
    return message;
  }

  stream() {
    let stream = new WriteStream(),
      fields = this.getFields();

    // writing to buffer
    for (let field of fields) {
      field.write(stream);
    }

    return stream;
  }

  buffer() {
    return this.stream().buffer();
  }
}

function interpretCommand(stream, isLast) {
  parseDicomMessage(stream);
}

function mergePDVs(pdvs) {
  let merges = [],
    count = pdvs.length,
    i = 0;
  while (i < count) {
    console.log(pdvs[i].isLast, pdvs[i].type);
    if (!pdvs[i].isLast) {
      let j = i;
      while (!pdvs[j++].isLast && j < count) {
        pdvs[i].messageStream.concat(pdvs[j].messageStream);
      }
      merges.push(pdvs[i]);
      i = j;
    } else {
      merges.push(pdvs[i++]);
    }
  }
  return merges;
}

function pduByStream(stream) {
  if (stream.end()) return null;

  let pduType = stream.read(C.TYPE_HEX, 1),
    typeNum = parseInt(pduType, 16),
    pdu = null;
  //console.log("RECEIVED PDU-TYPE ", pduType);
  switch (typeNum) {
    case 0x02:
      pdu = new AssociateAC();
      break;
    case 0x03:
      pdu = new AssociateReject();
      break;
    case 0x04:
      pdu = new PDataTF();
      break;
    case 0x06:
      pdu = new ReleaseRP();
      break;
    case 0x07:
      pdu = new AssociateAbort();
      break;
    case 0x10:
      pdu = new ApplicationContextItem();
      break;
    case 0x21:
      pdu = new PresentationContextItem();
      break;
    case 0x40:
      pdu = new TransferSyntaxItem();
      break;
    case 0x50:
      pdu = new UserInformationItem();
      break;
    case 0x51:
      pdu = new MaximumLengthItem();
      break;
    case 0x52:
      pdu = new ImplementationClassUIDItem();
      break;
    case 0x55:
      pdu = new ImplementationVersionNameItem();
      break;
    default:
      throw "Unrecoginized pdu type " + pduType;
      break;
  }
  if (pdu)
    pdu.read(stream);

  return pdu;
}

function nextItemIs(stream, pduType) {
  if (stream.end()) return false;

  let nextType = stream.read(C.TYPE_HEX, 1);
  stream.increment(-1);
  return pduType == nextType;
}

class AssociateRQ extends PDU {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_PDU_ASSOCIATE_RQ;
    this.protocolVersion = 1;
  }

  setProtocolVersion(version) {
    this.protocolVersion = version;
  }

  setCalledAETitle(title) {
    this.calledAETitle = title;
  }

  setCallingAETitle(title) {
    this.callingAETitle = title;
  }

  setApplicationContextItem(item) {
    this.applicationContextItem = item;
  }

  setPresentationContextItems(items) {
    this.presentationContextItems = items;
  }

  setUserInformationItem(item) {
    this.userInformationItem = item;
  }

  allAccepted() {
    for (let item of this.presentationContextItems) {
      if (!item.accepted()) return false;
    }
    return true;
  }

  getFields() {
    let f = [
      new F.UInt16Field(this.protocolVersion), new F.ReservedField(2),
      new F.FilledField(this.calledAETitle, 16), new F.FilledField(this.callingAETitle, 16),
      new F.ReservedField(32), this.applicationContextItem
    ];
    for (let context of this.presentationContextItems) {
      f.push(context);
    }
    f.push(this.userInformationItem);
    return super.getFields(f);
  }

  buffer() {
    return super.buffer();
  }
}

class AssociateAC extends AssociateRQ {
  readBytes(stream, length) {
    this.type = C.ITEM_TYPE_PDU_ASSOCIATE_AC;
    let version = stream.read(C.TYPE_UINT16);
    this.setProtocolVersion(version);
    stream.increment(66);

    let appContext = this.load(stream);
    this.setApplicationContextItem(appContext);

    let presContexts = [];
    do {
      presContexts.push(this.load(stream));
    } while (nextItemIs(stream, C.ITEM_TYPE_PRESENTATION_CONTEXT_AC));
    this.setPresentationContextItems(presContexts);

    let userItem = this.load(stream);
    this.setUserInformationItem(userItem);
  }
}

class AssociateReject extends PDU {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_PDU_ASSOCIATE_REJECT;
    this.result = 1;
    this.source = 3;
    this.reason = 0;
  }

  readBytes(stream, length) {
    stream.increment(1);
    this.result = stream.read(C.TYPE_UINT8);
    this.source = stream.read(C.TYPE_UINT8);
    this.reason = stream.read(C.TYPE_UINT8);
  }
}

class AssociateAbort extends PDU {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_PDU_AABORT;
    this.source = 1;
    this.reason = 0;
  }

  setSource(src) {
    this.source = src;
  }

  setReason(reason) {
    this.reason = reason;
  }

  readBytes(stream, length) {
    stream.increment(2);

    let source = stream.read(C.TYPE_UINT8);
    this.setSource(source);

    let reason = stream.read(C.TYPE_UINT8);
    this.setReason(reason);
  }

  getFields() {
    return super.getFields([
      new F.ReservedField(), new F.ReservedField(),
      new F.UInt8Field(this.source), new F.UInt8Field(this.reason)
    ]);
  }
}

class ReleaseRQ extends PDU {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_PDU_RELEASE_RQ;
  }

  getFields() {
    return super.getFields([new F.ReservedField(4)]);
  }
}

class ReleaseRP extends PDU {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_PDU_RELEASE_RP;
  }

  readBytes(stream, length) {
    stream.increment(4);
  }

  getFields() {
    return super.getFields([new F.ReservedField(4)]);
  }
}

class PDataTF extends PDU {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_PDU_PDATA;
    this.presentationDataValueItems = [];
  }

  setPresentationDataValueItems(items) {
    this.presentationDataValueItems = items ? items : [];
  }

  getFields() {
    let fields = this.presentationDataValueItems;

    return super.getFields(fields);
  }

  readBytes(stream, length) {
    let pdvs = this.loadPDV(stream, length);
    //let merges = mergePDVs(pdvs);

    this.setPresentationDataValueItems(pdvs);
  }
}

class Item extends PDU {
  constructor() {
    super();
    this.lengthBytes = 2;
  }

  read(stream) {
    stream.read(C.TYPE_HEX, 1);
    let length = stream.read(C.TYPE_UINT16);
    this.readBytes(stream, length);
  }

  write(stream) {
    stream.concat(this.stream());
  }
}

class PresentationDataValueItem extends Item {
  constructor(context) {
    super();
    this.type = null;
    this.isLast = true;
    this.dataFragment = null;
    this.contextId = context;
    this.messageStream = null;

    this.lengthBytes = 4;
  }

  setContextId(id) {
    this.contextId = id;
  }

  setFlag(flag) {
    this.flag = flag;
  }

  setPresentationDataValue(pdv) {
    this.pdv = pdv;
  }

  setMessage(msg) {
    this.dataFragment = msg;
  }

  getMessage() {
    return this.dataFragment;
  }

  readBytes(stream, length) {
    this.contextId = stream.read(C.TYPE_UINT8);
    let messageHeader = stream.read(C.TYPE_UINT8);
    this.isLast = messageHeader >> 1;
    this.type = messageHeader & 1 ? C.DATA_TYPE_COMMAND : C.DATA_TYPE_DATA;
    //console.log(stream.offset, length);
    //load dicom messages
    this.messageStream = stream.more(length - 2);
  }

  getFields() {
    let fields = [new F.UInt8Field(this.contextId)];
    //define header
    let messageHeader = (1 & this.dataFragment.type) | ((this.isLast ? 1 : 0) << 1);
    fields.push(new F.UInt8Field(messageHeader));

    fields.push(this.dataFragment);

    return super.getFields(fields);
  }
}

class ApplicationContextItem extends Item {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_APPLICATION_CONTEXT;
    this.applicationContextName = C.APPLICATION_CONTEXT_NAME;
  }

  setApplicationContextName(name) {
    this.applicationContextName = name;
  }

  getFields() {
    return super.getFields([new F.StringField(this.applicationContextName)]);
  }

  readBytes(stream, length) {
    let appContext = stream.read(C.TYPE_ASCII, length);
    this.setApplicationContextName(appContext);
  }

  buffer() {
    return super.buffer();
  }
}

class PresentationContextItem extends Item {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_PRESENTATION_CONTEXT;
  }

  setPresentationContextID(id) {
    this.presentationContextID = id;
  }

  setAbstractSyntaxItem(item) {
    this.abstractSyntaxItem = item;
  }

  setTransferSyntaxesItems(items) {
    this.transferSyntaxesItems = items;
  }

  setResultReason(reason) {
    this.resultReason = reason;
  }

  accepted() {
    return this.resultReason == 0;
  }

  readBytes(stream, length) {
    let contextId = stream.read(C.TYPE_UINT8);
    this.setPresentationContextID(contextId);
    stream.increment(1);
    let resultReason = stream.read(C.TYPE_UINT8);
    this.setResultReason(resultReason);
    stream.increment(1);

    let transferItem = this.load(stream);
    this.setTransferSyntaxesItems([transferItem]);
  }

  getFields() {
    let f = [
      new F.UInt8Field(this.presentationContextID),
      new F.ReservedField(), new F.ReservedField(), new F.ReservedField(), this.abstractSyntaxItem
    ];
    for (let syntaxItem of this.transferSyntaxesItems) {
      f.push(syntaxItem);
    }
    return super.getFields(f);
  }

  buffer() {
    return super.buffer();
  }
}

class AbstractSyntaxItem extends Item {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_ABSTRACT_CONTEXT;
  }

  setAbstractSyntaxName(name) {
    this.abstractSyntaxName = name;
  }

  getFields() {
    return super.getFields([new F.StringField(this.abstractSyntaxName)]);
  }

  buffer() {
    return super.buffer();
  }
}

class TransferSyntaxItem extends Item {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_TRANSFER_CONTEXT;
  }

  setTransferSyntaxName(name) {
    this.transferSyntaxName = name;
  }

  readBytes(stream, length) {
    let transfer = stream.read(C.TYPE_ASCII, length);
    this.setTransferSyntaxName(transfer);
  }

  getFields() {
    return super.getFields([new F.StringField(this.transferSyntaxName)]);
  }

  buffer() {
    return super.buffer();
  }
}

class UserInformationItem extends Item {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_USER_INFORMATION;
  }

  setUserDataItems(items) {
    this.userDataItems = items;
  }

  readBytes(stream, length) {
    let items = [],
      pdu = this.load(stream);

    do {
      items.push(pdu);
    } while (pdu = this.load(stream));
    this.setUserDataItems(items);
  }

  getFields() {
    let f = [];
    for (let userData of this.userDataItems) {
      f.push(userData);
    }
    return super.getFields(f);
  }

  buffer() {
    return super.buffer();
  }
}

class ImplementationClassUIDItem extends Item {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_IMPLEMENTATION_UID;
  }

  setImplementationClassUID(id) {
    this.implementationClassUID = id;
  }

  readBytes(stream, length) {
    let uid = stream.read(C.TYPE_ASCII, length);
    this.setImplementationClassUID(uid);
  }

  getFields() {
    return super.getFields([new F.StringField(this.implementationClassUID)]);
  }

  buffer() {
    return super.buffer();
  }
}

class ImplementationVersionNameItem extends Item {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_IMPLEMENTATION_VERSION;
  }

  setImplementationVersionName(name) {
    this.implementationVersionName = name;
  }

  readBytes(stream, length) {
    let name = stream.read(C.TYPE_ASCII, length);
    this.setImplementationVersionName(name);
  }

  getFields() {
    return super.getFields([new F.StringField(this.implementationVersionName)]);
  }

  buffer() {
    return super.buffer();
  }
}

class MaximumLengthItem extends Item {
  constructor() {
    super();
    this.type = C.ITEM_TYPE_MAXIMUM_LENGTH;
    this.maximumLengthReceived = 32768;
  }

  setMaximumLengthReceived(length) {
    this.maximumLengthReceived = length;
  }

  readBytes(stream, length) {
    length = stream.read(C.TYPE_UINT32);
    this.setMaximumLengthReceived(length);
  }

  getFields() {
    return super.getFields([new F.UInt32Field(this.maximumLengthReceived)]);
  }

  buffer() {
    return super.buffer();
  }
}

module.exports = {
  PDU,
  interpretCommand,
  mergePDVs,
  pduByStream,
  AssociateRQ,
  AssociateAC,
  AssociateAbort,
  ReleaseRP,
  ReleaseRQ,
  PDataTF,
  Item,
  PresentationDataValueItem,
  ApplicationContextItem,
  PresentationContextItem,
  AbstractSyntaxItem,
  TransferSyntaxItem,
  UserInformationItem,
  ImplementationClassUIDItem,
  ImplementationVersionNameItem,
  MaximumLengthItem
}
