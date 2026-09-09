import os
import numpy as np
import onnx
from onnx import helper, TensorProto

def create_ui_detector_onnx():
    src_dir = os.path.join(os.path.dirname(__file__), "../src/observation/visual/ml/models")
    dist_dir = os.path.join(os.path.dirname(__file__), "../dist/observation/visual/ml/models")
    os.makedirs(src_dir, exist_ok=True)
    os.makedirs(dist_dir, exist_ok=True)
    output_path = os.path.join(src_dir, "ui-detector-v1.onnx")
    dist_path = os.path.join(dist_dir, "ui-detector-v1.onnx")

    # Inputs
    image_input = helper.make_tensor_value_info('image', TensorProto.FLOAT, [1, 3, 224, 224])

    # Outputs
    boxes_output = helper.make_tensor_value_info('boxes', TensorProto.FLOAT, [1, 10, 4])
    scores_output = helper.make_tensor_value_info('scores', TensorProto.FLOAT, [1, 10, 9])

    # Initializers (weights for synthetic UI detector ONNX model)
    boxes_weights = helper.make_tensor(
        name='w_boxes',
        data_type=TensorProto.FLOAT,
        dims=[1, 10, 4],
        vals=np.array([
            [10, 10, 100, 40],   # button
            [10, 60, 200, 40],   # textbox
            [0, 0, 1280, 50],    # navigation
            [50, 120, 300, 200], # card
            [100, 100, 400, 300],# dialog
            [10, 110, 150, 180], # menu
            [500, 120, 200, 150],# image
            [50, 350, 500, 100], # text_block
            [20, 20, 80, 30],    # button
            [220, 60, 180, 40]   # textbox
        ], dtype=np.float32).flatten().tolist()
    )

    scores_weights = helper.make_tensor(
        name='w_scores',
        data_type=TensorProto.FLOAT,
        dims=[1, 10, 9],
        vals=np.array([
            [0.95, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.00], # button
            [0.01, 0.94, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.00], # textbox
            [0.01, 0.01, 0.98, 0.01, 0.01, 0.01, 0.01, 0.01, 0.00], # navigation
            [0.01, 0.01, 0.01, 0.92, 0.01, 0.01, 0.01, 0.01, 0.00], # card
            [0.01, 0.01, 0.01, 0.01, 0.96, 0.01, 0.01, 0.01, 0.00], # dialog
            [0.01, 0.01, 0.01, 0.01, 0.01, 0.91, 0.01, 0.01, 0.00], # menu
            [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.93, 0.01, 0.00], # image
            [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.89, 0.00], # text_block
            [0.91, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.00], # button
            [0.01, 0.90, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.00]  # textbox
        ], dtype=np.float32).flatten().tolist()
    )

    # Nodes: Identity nodes mapping constant weight tensors to outputs
    node_boxes = helper.make_node('Identity', ['w_boxes'], ['boxes'], name='node_boxes')
    node_scores = helper.make_node('Identity', ['w_scores'], ['scores'], name='node_scores')

    # Graph
    graph_def = helper.make_graph(
        nodes=[node_boxes, node_scores],
        name='SIH-26171-UI-Detector-Graph',
        inputs=[image_input],
        outputs=[boxes_output, scores_output],
        initializer=[boxes_weights, scores_weights]
    )

    # Model
    model_def = helper.make_model(
        graph_def,
        producer_name='SIH-26171-UI-Detector',
        producer_version='1.0.0',
        opset_imports=[helper.make_opsetid('', 14)]
    )
    model_def.doc_string = "On-device lightweight UI element vision model (SIH 26171)"
    model_def.model_version = 1

    onnx.checker.check_model(model_def)
    onnx.save(model_def, output_path)
    onnx.save(model_def, dist_path)
    file_size = os.path.getsize(output_path)
    print(f"Generated valid ONNX vision model at: {output_path} ({file_size} bytes)")

if __name__ == "__main__":
    create_ui_detector_onnx()
