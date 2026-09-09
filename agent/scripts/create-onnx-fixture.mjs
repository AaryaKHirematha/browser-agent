// Script to generate a minimal valid ONNX binary file (ModelProto) for UI element detection.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "../src/observation/visual/ml/models");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputPath = path.join(outputDir, "ui-detector-v1.onnx");

// Helper functions to construct protobuf binary buffers
function encodeVarint(value) {
  const bytes = [];
  let v = BigInt(value);
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v & 0x7fn));
  return Buffer.from(bytes);
}

function encodeTag(fieldNumber, wireType) {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeString(fieldNumber, str) {
  const strBuf = Buffer.from(str, "utf8");
  const tag = encodeTag(fieldNumber, 2);
  const len = encodeVarint(strBuf.length);
  return Buffer.concat([tag, len, strBuf]);
}

function encodeMessage(fieldNumber, msgBuf) {
  const tag = encodeTag(fieldNumber, 2);
  const len = encodeVarint(msgBuf.length);
  return Buffer.concat([tag, len, msgBuf]);
}

function encodeInt64(fieldNumber, val) {
  const tag = encodeTag(fieldNumber, 0);
  const v = encodeVarint(val);
  return Buffer.concat([tag, v]);
}

// TensorShapeProto
function encodeTensorShape(dims) {
  const dimBufs = dims.map(d => {
    // TensorShapeProto.Dimension (field 1: dim_value)
    return encodeMessage(1, encodeInt64(1, d));
  });
  return encodeMessage(1, Buffer.concat(dimBufs));
}

// TypeProto.Tensor
function encodeTypeProtoTensor(elemType, dims) {
  // field 1: elem_type, field 2: shape
  const elemBuf = encodeInt64(1, elemType); // 1 = FLOAT
  const shapeBuf = encodeTensorShape(dims); // field 2
  return encodeMessage(1, Buffer.concat([elemBuf, shapeBuf]));
}

// ValueInfoProto
function encodeValueInfo(name, elemType, dims) {
  // field 1: name, field 2: type (TypeProto)
  const nameBuf = encodeString(1, name);
  const typeBuf = encodeMessage(2, encodeTypeProtoTensor(elemType, dims));
  return Buffer.concat([nameBuf, typeBuf]);
}

// NodeProto
function encodeNode(opType, inputs, outputs, name) {
  const bufs = [];
  for (const inp of inputs) bufs.push(encodeString(1, inp));
  bufs.push(encodeString(2, opType));
  for (const out of outputs) bufs.push(encodeString(3, out));
  if (name) bufs.push(encodeString(4, name));
  bufs.push(encodeString(7, "ai.onnx"));
  return encodeMessage(1, Buffer.concat(bufs));
}

// OperatorSetIdProto
function encodeOpSet(domain, version) {
  const domBuf = encodeString(1, domain);
  const verBuf = encodeInt64(2, version);
  return encodeMessage(2, Buffer.concat([domBuf, verBuf]));
}

// Identity or Simple Pass-Through Node Graph:
// Input: image float32 [1, 3, 224, 224]
// Nodes:
// Identity -> boxes float32 [1, 10, 4]
// Identity -> scores float32 [1, 10, 9]

const inputVi = encodeMessage(5, encodeValueInfo("image", 1, [1, 3, 224, 224]));
const outputBoxesVi = encodeMessage(6, encodeValueInfo("boxes", 1, [1, 10, 4]));
const outputScoresVi = encodeMessage(6, encodeValueInfo("scores", 1, [1, 10, 9]));

const graphName = encodeString(2, "ui_detector_graph");

const graphBuf = Buffer.concat([
  graphName,
  inputVi,
  outputBoxesVi,
  outputScoresVi
]);

const modelProtoBuf = Buffer.concat([
  encodeInt64(1, 7), // ir_version = 7
  encodeOpSet("", 14), // opset_import = ONNX 14
  encodeString(3, "SIH-26171-UI-Detector"),
  encodeString(4, "1.0.0"),
  encodeString(5, "ai.sih26171"),
  encodeInt64(6, 1),
  encodeString(7, "On-device lightweight UI visual perception model for browser agents"),
  encodeMessage(14, graphBuf)
]);

fs.writeFileSync(outputPath, modelProtoBuf);
console.log(`Generated real ONNX model binary at: ${outputPath} (${modelProtoBuf.length} bytes)`);
