import onnx
from onnx import helper, TensorProto
m = onnx.load("mobilenetv2-12.onnx")
g = m.graph
g.node.remove([n for n in g.node if n.op_type == "Gemm"][0])
for init in list(g.initializer):
    if init.name.startswith("classifier"): g.initializer.remove(init)
del g.output[:]
parts = ["472"]
for t in ["474", "480", "489", "339", "365", "400", "426", "452"]:
    g.node.extend([
        helper.make_node("ReduceMean", [t], [f"{t}_mean4"], axes=[2, 3], keepdims=1),
        helper.make_node("Mul", [t, t], [f"{t}_sq"]),
        helper.make_node("ReduceMean", [f"{t}_sq"], [f"{t}_m2_4"], axes=[2, 3], keepdims=1),
        helper.make_node("Flatten", [f"{t}_mean4"], [f"{t}_mean"], axis=1),
        helper.make_node("Flatten", [f"{t}_m2_4"], [f"{t}_m2"], axis=1),
    ])
    parts += [f"{t}_mean", f"{t}_m2"]
g.node.append(helper.make_node("Concat", parts, ["features"], axis=1))
g.output.append(helper.make_tensor_value_info("features", TensorProto.FLOAT, ["batch_size", 2032 + 2*(32+16+24)]))
onnx.checker.check_model(m)
onnx.save(m, "mnv2_features.onnx")
print("saved")
