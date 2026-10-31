import React, { useState, useEffect, useMemo } from 'react';
import { 
  Tags, 
  FolderPlus, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Layers, 
  Sparkles, 
  Check, 
  X, 
  AlertCircle,
  Apple,
  Car,
  CreditCard,
  FileText,
  Coffee,
  Shirt,
  Zap,
  Droplet,
  Building,
  Banknote,
  Flame,
  Fuel,
  Receipt,
  PawPrint,
  Gamepad2,
  Heart,
  Landmark,
  UtensilsCrossed,
  Activity,
  Shield,
  Phone,
  Plane,
  Home,
  HelpCircle,
  Folder,
  Wand2,
  ArrowRight
} from 'lucide-react';
import { api } from '../services/api';
import './CategoriesView.css';

// Mapeo seguro de nombres de icono a componentes Lucide
const ICON_MAP = {
  Apple: <Apple size={18} />,
  Car: <Car size={18} />,
  CreditCard: <CreditCard size={18} />,
  FileText: <FileText size={18} />,
  Coffee: <Coffee size={18} />,
  Shirt: <Shirt size={18} />,
  Zap: <Zap size={18} />,
  Droplet: <Droplet size={18} />,
  Building: <Building size={18} />,
  Banknote: <Banknote size={18} />,
  Flame: <Flame size={18} />,
  Fuel: <Fuel size={18} />,
  Receipt: <Receipt size={18} />,
  PawPrint: <PawPrint size={18} />,
  Gamepad2: <Gamepad2 size={18} />,
  Heart: <Heart size={18} />,
  Landmark: <Landmark size={18} />,
  UtensilsCrossed: <UtensilsCrossed size={18} />,
  Activity: <Activity size={18} />,
  Shield: <Shield size={18} />,
  Phone: <Phone size={18} />,
  Plane: <Plane size={18} />,
  Home: <Home size={18} />,
  HelpCircle: <HelpCircle size={18} />,
  Folder: <Folder size={18} />,
  Tags: <Tags size={18} />
};

const COLOR_PALETTE = [
  '#38bdf8', '#3b82f6', '#6366f1', '#8b5cf6', 
  '#ec4899', '#f43f5e', '#ef4444', '#f97316', 
  '#f59e0b', '#10b981', '#14b8a6', '#06b6d4', 
  '#64748b'
];

export default function CategoriesView() {
  const [categories, setCategories] = useState([]);
  const [supraCategories, setSupraCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filtros & búsqueda
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupraFilter, setSelectedSupraFilter] = useState('ALL');
  const [viewMode, setViewMode] = useState('alphabetical'); // 'alphabetical' | 'grouped' | 'rules'

  // Reglas automáticas
  const [rules, setRules] = useState([]);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({ concept: '', category_id: '' });

  // Modales
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [supraModalOpen, setSupraModalOpen] = useState(false);
  const [editingSupra, setEditingSupra] = useState(null);

  // Form State para Categoría
  const [catForm, setCatForm] = useState({
    name: '',
    supra_category_id: '',
    color_hex: '#38bdf8',
    icon: 'Tags'
  });

  // Form State para Supra Categoría
  const [supraForm, setSupraForm] = useState({
    name: '',
    color_hex: '#6366f1',
    icon: 'Folder'
  });

  const [saving, setSaving] = useState(false);

  // Cargar categorías y supra categorías
  const fetchCategories = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getCategories();
      if (res.success && res.data) {
        setCategories(res.data.categories || []);
        setSupraCategories(res.data.supra_categories || []);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
      setError(err.message || 'Error al cargar las categorías');
    } finally {
      setLoading(false);
    }
  };

  const fetchRules = async () => {
    try {
      const res = await api.getCategoryRules();
      if (res.success && res.data) {
        setRules(res.data.rules || []);
      }
    } catch (err) {
      console.error('Error fetching rules:', err);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchRules();
  }, []);

  const filteredRules = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return rules.filter((r) =>
      r.concept.toLowerCase().includes(q) || r.category_name.toLowerCase().includes(q)
    );
  }, [rules, searchQuery]);

  // Filtrado y ordenación estrictamente alfabética por nombre
  const filteredCategories = useMemo(() => {
    return categories
      .filter((cat) => {
        const matchesSearch = cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          cat.supra_category_name?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesSupra = selectedSupraFilter === 'ALL' || String(cat.supra_category_id) === String(selectedSupraFilter);
        return matchesSearch && matchesSupra;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }, [categories, searchQuery, selectedSupraFilter]);

  // Agrupadas por Supra Categoría
  const groupedCategories = useMemo(() => {
    const groups = {};
    supraCategories.forEach((supra) => {
      groups[supra.id] = {
        supra,
        items: []
      };
    });

    filteredCategories.forEach((cat) => {
      if (groups[cat.supra_category_id]) {
        groups[cat.supra_category_id].items.push(cat);
      }
    });

    return Object.values(groups).filter(g => g.items.length > 0 || selectedSupraFilter === String(g.supra.id));
  }, [supraCategories, filteredCategories, selectedSupraFilter]);

  // Abrir modal de crear/editar categoría
  const handleOpenCatModal = (catToEdit = null) => {
    if (catToEdit) {
      setEditingCategory(catToEdit);
      setCatForm({
        name: catToEdit.name,
        supra_category_id: String(catToEdit.supra_category_id),
        color_hex: catToEdit.color_hex || '#38bdf8',
        icon: catToEdit.icon || 'Tags'
      });
    } else {
      setEditingCategory(null);
      setCatForm({
        name: '',
        supra_category_id: supraCategories[0]?.id ? String(supraCategories[0].id) : '',
        color_hex: '#38bdf8',
        icon: 'Tags'
      });
    }
    setCategoryModalOpen(true);
  };

  // Abrir modal de crear/editar supra categoría
  const handleOpenSupraModal = (supraToEdit = null) => {
    if (supraToEdit) {
      setEditingSupra(supraToEdit);
      setSupraForm({
        name: supraToEdit.name,
        color_hex: supraToEdit.color_hex || '#6366f1',
        icon: supraToEdit.icon || 'Folder'
      });
    } else {
      setEditingSupra(null);
      setSupraForm({
        name: '',
        color_hex: '#6366f1',
        icon: 'Folder'
      });
    }
    setSupraModalOpen(true);
  };

  // Guardar Categoría
  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!catForm.name.trim() || !catForm.supra_category_id) return;

    try {
      setSaving(true);
      if (editingCategory) {
        await api.updateCategory(editingCategory.id, {
          name: catForm.name.trim(),
          supra_category_id: parseInt(catForm.supra_category_id, 10),
          color_hex: catForm.color_hex,
          icon: catForm.icon
        });
      } else {
        await api.createCategory({
          name: catForm.name.trim(),
          supra_category_id: parseInt(catForm.supra_category_id, 10),
          color_hex: catForm.color_hex,
          icon: catForm.icon
        });
      }
      setCategoryModalOpen(false);
      await fetchCategories();
    } catch (err) {
      alert(err.message || 'Error guardando categoría');
    } finally {
      setSaving(false);
    }
  };

  // Guardar Supra Categoría
  const handleSaveSupra = async (e) => {
    e.preventDefault();
    if (!supraForm.name.trim()) return;

    try {
      setSaving(true);
      if (editingSupra) {
        await api.updateSupraCategory(editingSupra.id, {
          name: supraForm.name.trim(),
          color_hex: supraForm.color_hex,
          icon: supraForm.icon
        });
      } else {
        await api.createSupraCategory({
          name: supraForm.name.trim(),
          color_hex: supraForm.color_hex,
          icon: supraForm.icon
        });
      }
      setSupraModalOpen(false);
      await fetchCategories();
    } catch (err) {
      alert(err.message || 'Error guardando supra categoría');
    } finally {
      setSaving(false);
    }
  };

  // Eliminar Categoría
  const handleDeleteCategory = async (cat) => {
    if (!cat.is_custom) {
      alert('Las categorías base del sistema no pueden ser eliminadas.');
      return;
    }
    if (!window.confirm(`¿Seguro que deseas eliminar la categoría "${cat.name}"?`)) return;

    try {
      await api.deleteCategory(cat.id);
      await fetchCategories();
    } catch (err) {
      alert(err.message || 'Error al eliminar');
    }
  };

  // Editar Regla
  const handleOpenRuleModal = (rule) => {
    setEditingRule(rule);
    setRuleForm({ concept: rule.concept, category_id: String(rule.category_id) });
  };

  const handleSaveRule = async (e) => {
    e.preventDefault();
    if (!ruleForm.concept.trim() || !ruleForm.category_id) return;

    try {
      setSaving(true);
      await api.updateCategoryRule(editingRule.id, {
        concept: ruleForm.concept.trim(),
        category_id: parseInt(ruleForm.category_id, 10)
      });
      setEditingRule(null);
      await fetchRules();
    } catch (err) {
      alert(err.message || 'Error guardando la regla');
    } finally {
      setSaving(false);
    }
  };

  // Eliminar Regla
  const handleDeleteRule = async (rule) => {
    if (!window.confirm(`¿Seguro que deseas eliminar la regla "${rule.concept}" → ${rule.category_name}?`)) return;

    try {
      await api.deleteCategoryRule(rule.id);
      await fetchRules();
    } catch (err) {
      alert(err.message || 'Error al eliminar la regla');
    }
  };

  return (
    <div className="categories-view">
      {/* Encabezado */}
      <section className="cat-header glass-panel">
        <div className="cat-header-info">
          <h2>Gestión de Categorías & Supra Categorías</h2>
          <p>Organiza tus gastos y transferencias en categorías agrupadas para un análisis gráfico preciso.</p>
        </div>
        <div className="cat-header-actions">
          <button onClick={() => handleOpenSupraModal()} className="btn-secondary-action">
            <FolderPlus size={18} />
            <span>Nueva Supra Categoría</span>
          </button>
          <button onClick={() => handleOpenCatModal()} className="btn-primary-action">
            <Plus size={18} />
            <span>Nueva Categoría</span>
          </button>
        </div>
      </section>

      {/* Barra de Filtros y Búsqueda */}
      <section className="cat-toolbar">
        <div className="cat-search-box">
          <Search size={18} className="cat-search-icon" />
          <input
            type="text"
            className="cat-search-input"
            placeholder={viewMode === 'rules' ? 'Buscar por concepto o categoría...' : 'Buscar por categoría o supra...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="cat-mode-pills">
          <button 
            className={`cat-pill ${viewMode === 'alphabetical' ? 'active' : ''}`}
            onClick={() => setViewMode('alphabetical')}
          >
            <Tags size={15} />
            <span>Alfabético ({filteredCategories.length})</span>
          </button>
          <button 
            className={`cat-pill ${viewMode === 'grouped' ? 'active' : ''}`}
            onClick={() => setViewMode('grouped')}
          >
            <Layers size={15} />
            <span>Por Supra Categoría</span>
          </button>
          <button
            className={`cat-pill ${viewMode === 'rules' ? 'active' : ''}`}
            onClick={() => setViewMode('rules')}
          >
            <Wand2 size={15} />
            <span>Reglas automáticas ({rules.length})</span>
          </button>
        </div>
      </section>

      {/* Chip selector de Supra Categorías */}
      {viewMode !== 'rules' && (
      <section className="supra-summary-bar">
        <button
          className={`supra-filter-chip ${selectedSupraFilter === 'ALL' ? 'active' : ''}`}
          onClick={() => setSelectedSupraFilter('ALL')}
        >
          <span>Todas ({categories.length})</span>
        </button>
        {supraCategories.map((s) => (
          <button
            key={s.id}
            className={`supra-filter-chip ${selectedSupraFilter === String(s.id) ? 'active' : ''}`}
            onClick={() => setSelectedSupraFilter(selectedSupraFilter === String(s.id) ? 'ALL' : String(s.id))}
          >
            <span className="chip-dot" style={{ background: s.color_hex }} />
            <span>{s.name}</span>
          </button>
        ))}
      </section>
      )}

      {/* Renderizado de Categorías */}
      {viewMode === 'rules' ? (
        filteredRules.length === 0 ? (
          <div className="empty-state-card glass-panel">
            <Wand2 size={32} />
            <p>
              {rules.length === 0
                ? 'Aún no tienes reglas. Créalas al asignar una categoría a una transacción.'
                : 'No se encontraron reglas que coincidan con la búsqueda.'}
            </p>
          </div>
        ) : (
          <div className="rules-list">
            {filteredRules.map((rule) => (
              <div key={rule.id} className="rule-row glass-panel">
                <div className="rule-row-main">
                  <span className="rule-concept" title={rule.concept}>{rule.concept}</span>
                  <ArrowRight size={14} className="rule-arrow" />
                  <span
                    className="rule-category"
                    style={{
                      backgroundColor: `${rule.category_color}22`,
                      color: rule.category_color,
                      border: `1px solid ${rule.category_color}44`
                    }}
                  >
                    <Tags size={12} />
                    {rule.category_name}
                  </span>
                </div>
                <div className="cat-card-actions">
                  <button
                    onClick={() => handleOpenRuleModal(rule)}
                    className="btn-icon-subtle"
                    title="Editar regla"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteRule(rule)}
                    className="btn-icon-subtle delete"
                    title="Eliminar regla"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="empty-state-card glass-panel">
          <Sparkles className="animate-spin text-sky-400" size={32} />
          <p>Cargando catálogo de categorías...</p>
        </div>
      ) : error ? (
        <div className="empty-state-card glass-panel text-red-400">
          <AlertCircle size={32} />
          <p>{error}</p>
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="empty-state-card glass-panel">
          <Tags size={32} />
          <p>No se encontraron categorías que coincidan con la búsqueda.</p>
        </div>
      ) : viewMode === 'alphabetical' ? (
        <div className="categories-alphabetical-grid">
          {filteredCategories.map((cat) => (
            <div 
              key={cat.id} 
              className="cat-card glass-panel"
              style={{ '--cat-accent': cat.color_hex }}
            >
              <div className="cat-card-left">
                <div 
                  className="cat-icon-circle"
                  style={{ 
                    backgroundColor: `${cat.color_hex}22`,
                    color: cat.color_hex,
                    border: `1px solid ${cat.color_hex}44`
                  }}
                >
                  {ICON_MAP[cat.icon] || <Tags size={18} />}
                </div>
                <div className="cat-details">
                  <div className="cat-name-row">
                    <span className="cat-name">{cat.name}</span>
                    {cat.is_custom ? <span className="custom-tag">Personalizada</span> : null}
                  </div>
                  <div className="cat-supra-badge">
                    <span 
                      className="supra-indicator" 
                      style={{ background: cat.supra_color_hex || '#6366f1' }}
                    />
                    <span>{cat.supra_category_name}</span>
                  </div>
                </div>
              </div>

              <div className="cat-card-actions">
                <button 
                  onClick={() => handleOpenCatModal(cat)}
                  className="btn-icon-subtle"
                  title="Editar categoría"
                >
                  <Edit2 size={14} />
                </button>
                {cat.is_custom ? (
                  <button 
                    onClick={() => handleDeleteCategory(cat)}
                    className="btn-icon-subtle delete"
                    title="Eliminar categoría"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Vista Agrupada por Supra Categoría */
        <div className="supra-group-section">
          {groupedCategories.map(({ supra, items }) => (
            <div key={supra.id} className="supra-group-block">
              <div className="supra-group-header">
                <div className="supra-group-title">
                  <span className="chip-dot" style={{ background: supra.color_hex, width: 10, height: 10 }} />
                  <span>{supra.name}</span>
                  <span className="supra-badge-count">{items.length} categorías</span>
                </div>
                <button 
                  onClick={() => handleOpenSupraModal(supra)}
                  className="btn-icon-subtle"
                  title="Editar Supra Categoría"
                >
                  <Edit2 size={14} />
                </button>
              </div>

              <div className="categories-alphabetical-grid" style={{ marginTop: 12 }}>
                {items.map((cat) => (
                  <div 
                    key={cat.id} 
                    className="cat-card glass-panel"
                    style={{ '--cat-accent': cat.color_hex }}
                  >
                    <div className="cat-card-left">
                      <div 
                        className="cat-icon-circle"
                        style={{ 
                          backgroundColor: `${cat.color_hex}22`,
                          color: cat.color_hex,
                          border: `1px solid ${cat.color_hex}44`
                        }}
                      >
                        {ICON_MAP[cat.icon] || <Tags size={18} />}
                      </div>
                      <div className="cat-details">
                        <div className="cat-name-row">
                          <span className="cat-name">{cat.name}</span>
                          {cat.is_custom ? <span className="custom-tag">Personalizada</span> : null}
                        </div>
                        <div className="cat-supra-badge">
                          <span>{cat.supra_category_name}</span>
                        </div>
                      </div>
                    </div>

                    <div className="cat-card-actions">
                      <button 
                        onClick={() => handleOpenCatModal(cat)}
                        className="btn-icon-subtle"
                        title="Editar categoría"
                      >
                        <Edit2 size={14} />
                      </button>
                      {cat.is_custom ? (
                        <button 
                          onClick={() => handleDeleteCategory(cat)}
                          className="btn-icon-subtle delete"
                          title="Eliminar categoría"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Crear / Editar Categoría */}
      {categoryModalOpen ? (
        <div className="modal-overlay" onClick={() => setCategoryModalOpen(false)}>
          <div className="cat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cat-modal-header">
              <h3>{editingCategory ? 'Editar Categoría' : 'Nueva Categoría'}</h3>
              <button className="btn-icon-subtle" onClick={() => setCategoryModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCategory}>
              <div className="cat-modal-body">
                <div className="form-group">
                  <label>Nombre de la Categoría</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="Ej. Farmacia, Gasolina, Cursos..."
                    value={catForm.name}
                    onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Supra Categoría (Agrupación)</label>
                  <select
                    className="form-select"
                    value={catForm.supra_category_id}
                    onChange={(e) => setCatForm({ ...catForm, supra_category_id: e.target.value })}
                    required
                  >
                    <option value="" disabled>Selecciona una supra categoría</option>
                    {supraCategories.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Color Identificador</label>
                  <div className="color-picker-palette">
                    {COLOR_PALETTE.map((col) => (
                      <div
                        key={col}
                        className={`color-swatch ${catForm.color_hex === col ? 'selected' : ''}`}
                        style={{ backgroundColor: col }}
                        onClick={() => setCatForm({ ...catForm, color_hex: col })}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="cat-modal-footer">
                <button 
                  type="button" 
                  className="btn-secondary-action"
                  onClick={() => setCategoryModalOpen(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-primary-action"
                  disabled={saving}
                >
                  {saving ? <Sparkles className="animate-spin" size={16} /> : <Check size={16} />}
                  <span>{editingCategory ? 'Guardar Cambios' : 'Crear Categoría'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Editar Regla automática */}
      {editingRule ? (
        <div className="modal-overlay" onClick={() => setEditingRule(null)}>
          <div className="cat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cat-modal-header">
              <h3>Editar Regla</h3>
              <button className="btn-icon-subtle" onClick={() => setEditingRule(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveRule}>
              <div className="cat-modal-body">
                <div className="form-group">
                  <label>Concepto</label>
                  <input
                    type="text"
                    required
                    maxLength={255}
                    className="form-input"
                    value={ruleForm.concept}
                    onChange={(e) => setRuleForm({ ...ruleForm, concept: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Asignar a la categoría</label>
                  <select
                    className="form-select"
                    value={ruleForm.category_id}
                    onChange={(e) => setRuleForm({ ...ruleForm, category_id: e.target.value })}
                    required
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="cat-modal-footer">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setEditingRule(null)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary-action"
                  disabled={saving}
                >
                  {saving ? <Sparkles className="animate-spin" size={16} /> : <Check size={16} />}
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Crear / Editar Supra Categoría */}
      {supraModalOpen ? (
        <div className="modal-overlay" onClick={() => setSupraModalOpen(false)}>
          <div className="cat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cat-modal-header">
              <h3>{editingSupra ? 'Editar Supra Categoría' : 'Nueva Supra Categoría'}</h3>
              <button className="btn-icon-subtle" onClick={() => setSupraModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSupra}>
              <div className="cat-modal-body">
                <div className="form-group">
                  <label>Nombre de la Supra Categoría</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="Ej. Inversiones, Salud y Bienestar..."
                    value={supraForm.name}
                    onChange={(e) => setSupraForm({ ...supraForm, name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Color Identificador</label>
                  <div className="color-picker-palette">
                    {COLOR_PALETTE.map((col) => (
                      <div
                        key={col}
                        className={`color-swatch ${supraForm.color_hex === col ? 'selected' : ''}`}
                        style={{ backgroundColor: col }}
                        onClick={() => setSupraForm({ ...supraForm, color_hex: col })}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="cat-modal-footer">
                <button 
                  type="button" 
                  className="btn-secondary-action"
                  onClick={() => setSupraModalOpen(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-primary-action"
                  disabled={saving}
                >
                  {saving ? <Sparkles className="animate-spin" size={16} /> : <Check size={16} />}
                  <span>{editingSupra ? 'Guardar Cambios' : 'Crear Supra Categoría'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
