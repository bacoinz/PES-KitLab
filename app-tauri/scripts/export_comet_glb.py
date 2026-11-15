import bpy, bmesh, json, os, re, struct

# Run: blender -b "CometKITpreviewer V1.01blenderv2.80.blend" --python app-tauri/scripts/export_comet_glb.py
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models')
os.makedirs(OUT, exist_ok=True)

USED = set()
def slug(n):
    s = re.sub(r'[^a-z0-9]+', '_', n.lower()).strip('_')
    if n in ('Shirt_OUT', 'Shirt_IN'): s += '_tight'
    if n == 'GK_Sleeve.': s = 'gk_sleeve_2'
    return s

def kind(n):
    l = n.lower()
    if l.startswith('mesh_collar_'): return 'collar_pc'
    if l.startswith('collar_e'): return 'collar_ps4'
    if l.startswith('mesh_pants_'): return 'pants_hem'
    if 'pants' in l: return 'shorts'
    if l.startswith('socks'): return 'socks'
    if l.startswith('shirt'): return 'shirt'
    if l in ('arm', 'arm_long'): return 'arm'
    return 'sleeves'

def write_glb(path, pos, nrm, uv, idx):
    n = len(pos) // 3
    big = n > 65535
    ib = struct.pack('<%d%s' % (len(idx), 'I' if big else 'H'), *idx)
    while len(ib) % 4: ib += b'\0'
    pb = struct.pack('<%df' % len(pos), *pos)
    nb = struct.pack('<%df' % len(nrm), *nrm)
    ub = struct.pack('<%df' % len(uv), *uv)
    blob = pb + nb + ub + ib
    mn = [min(pos[i::3]) for i in range(3)]; mx = [max(pos[i::3]) for i in range(3)]
    o1 = len(pb); o2 = o1 + len(nb); o3 = o2 + len(ub)
    gl = {
        'asset': {'version': '2.0', 'generator': 'KitCreator Comet export'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': os.path.basename(path)[:-4]}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3}]}],
        'buffers': [{'byteLength': len(blob)}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': 0, 'byteLength': len(pb), 'target': 34962},
            {'buffer': 0, 'byteOffset': o1, 'byteLength': len(nb), 'target': 34962},
            {'buffer': 0, 'byteOffset': o2, 'byteLength': len(ub), 'target': 34962},
            {'buffer': 0, 'byteOffset': o3, 'byteLength': len(idx) * (4 if big else 2), 'target': 34963}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': mn, 'max': mx},
            {'bufferView': 1, 'componentType': 5126, 'count': n, 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5126, 'count': n, 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5125 if big else 5123, 'count': len(idx), 'type': 'SCALAR'}],
    }
    js = json.dumps(gl, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)

def export(ob, path):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    uvl = me.uv_layers.get('UVMap') or (me.uv_layers[0] if me.uv_layers else None)
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    cn = me.corner_normals  # Blender 4.1+
    verts = {}; pos = []; nrm = []; uv = []; idx = []
    for tri in me.loop_triangles:
        for li in tri.loops:
            v = me.loops[li].vertex_index
            p = mw @ me.vertices[v].co
            nn = (nm @ cn[li].vector).normalized()
            u = uvl.data[li].uv if uvl else (0, 0)
            key = (v, round(u[0], 6), round(u[1], 6), round(nn.x, 3), round(nn.y, 3), round(nn.z, 3))
            i = verts.get(key)
            if i is None:
                i = len(pos) // 3; verts[key] = i
                pos += [p.x, p.z, -p.y]; nrm += [nn.x, nn.z, -nn.y]; uv += [u[0], 1 - u[1]]
            idx.append(i)
    ev.to_mesh_clear()
    write_glb(path, pos, nrm, uv, idx)
    return len(idx) // 3, uv

def weld(ob):
    """The template meshes are split along UV seams; weld them (UVs stay per corner) so subdivision doesn't tear them."""
    me = ob.data.copy(); ob.data = me
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    for f in bm.faces: f.smooth = True
    for e in bm.edges: e.smooth = True
    bm.to_mesh(me); bm.free()
    if me.has_custom_normals: me.free_normals_split() if hasattr(me,'free_normals_split') else None
    try: bpy.context.view_layer.objects.active = ob; bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception as ex: pass

SMOOTH = {'shirt', 'sleeves', 'shorts', 'socks'}
for o in bpy.data.objects:
    o.hide_viewport = False
    try: o.hide_set(False)
    except Exception: pass
def unexclude(lc):
    lc.exclude = False; lc.hide_viewport = False
    for c in lc.children: unexclude(c)
unexclude(bpy.context.view_layer.layer_collection)
meta = []
for ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    if ob.name.lower().startswith('mesh_id'): continue
    k = kind(ob.name)
    weld(ob)
    base = slug(ob.name)
    tris, uv = export(ob, os.path.join(OUT, base + '.glb'))
    sd = None
    if k in SMOOTH:
        mod = ob.modifiers.new('kc_sub', 'SUBSURF'); mod.levels = 1; mod.render_levels = 1
        mod.uv_smooth = 'PRESERVE_BOUNDARIES'
        export(ob, os.path.join(OUT, base + '_sd.glb')); sd = base + '_sd.glb'
        ob.modifiers.remove(mod)
    us, vs = uv[0::2], uv[1::2]
    m = re.search(r'(\d+)$', ob.name)
    meta.append({'name': ob.name, 'file': base + '.glb', 'smooth': sd, 'kind': k,
                 'id': int(m.group(1)) if m and k in ('collar_pc', 'collar_ps4', 'pants_hem') else None,
                 'tris': tris, 'uvBox': [round(min(us) * 2048), round(min(vs) * 2048), round(max(us) * 2048), round(max(vs) * 2048)] if us else None})
json.dump(meta, open(os.path.join(OUT, 'models.json'), 'w'), indent=1)
print('exported', len(meta))



