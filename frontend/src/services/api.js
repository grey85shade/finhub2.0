// Por defecto la API está en la carpeta api/ junto al frontend (mismo origen). En desarrollo, Vite la reenvía
// a Apache (ver vite.config.js). VITE_API_URL solo hace falta si la API está en otro sitio.
const API_BASE_URL = (import.meta.env.VITE_API_URL || './api').replace(/\/$/, '');

class ApiService {
  getToken() {
    return localStorage.getItem('finhub_token');
  }

  setToken(token) {
    if (token) {
      localStorage.setItem('finhub_token', token);
    } else {
      localStorage.removeItem('finhub_token');
    }
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = this.getToken();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json().catch(() => ({
        success: false,
        error: 'Respuesta inválida del servidor.'
      }));

      if (!response.ok) {
        const error = new Error(data.error || `Error ${response.status}: Ha ocurrido un problema.`);
        error.errors = data.errors;
        throw error;
      }

      return data;
    } catch (err) {
      throw err;
    }
  }

  async register(userData) {
    const res = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
    if (res.data?.token) {
      this.setToken(res.data.token);
    }
    return res;
  }

  async login(credentials) {
    const res = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    });
    if (res.data?.token) {
      this.setToken(res.data.token);
    }
    return res;
  }

  async getStatus() {
    return this.request('/status', { method: 'GET' });
  }

  async testInstallDatabase(db) {
    return this.request('/install/database', { method: 'POST', body: JSON.stringify({ db }) });
  }

  async install(data) {
    return this.request('/install', { method: 'POST', body: JSON.stringify(data) });
  }

  async getProfile() {
    return this.request('/auth/me', {
      method: 'GET'
    });
  }

  async getBanks() {
    return this.request('/banks', { method: 'GET' });
  }

  async getDashboard() {
    return this.request('/dashboard', { method: 'GET' });
  }

  async dismissPlannedExpense(transactionId, scope) {
    return this.request('/planned-expenses/dismissals', {
      method: 'POST',
      body: JSON.stringify({ transaction_id: transactionId, scope })
    });
  }

  async restorePlannedExpense(dismissalId) {
    return this.request(`/planned-expenses/dismissals/${dismissalId}`, { method: 'DELETE' });
  }

  async getExpenses(from, to) {
    const params = new URLSearchParams({ from, to });
    return this.request(`/expenses?${params}`, { method: 'GET' });
  }

  async getBalance(year) {
    return this.request(`/balance?year=${encodeURIComponent(year)}`, { method: 'GET' });
  }

  async getInvestments() {
    return this.request('/investments', { method: 'GET' });
  }

  async syncFundPrices(force = false) {
    return this.request(`/investments/sync${force ? '?force=1' : ''}`, { method: 'POST' });
  }

  async createFund(accountId, fund) {
    return this.request(`/accounts/${accountId}/funds`, { method: 'POST', body: JSON.stringify(fund) });
  }

  async updateFund(accountId, fundId, fund) {
    return this.request(`/accounts/${accountId}/funds/${fundId}`, { method: 'PUT', body: JSON.stringify(fund) });
  }

  async deleteFund(accountId, fundId) {
    return this.request(`/accounts/${accountId}/funds/${fundId}`, { method: 'DELETE' });
  }

  async rebuildFundHistory(accountId, replaceManual = false) {
    return this.request(`/accounts/${accountId}/funds/rebuild`, { method: 'POST', body: JSON.stringify({ replace_manual: replaceManual }) });
  }

  async getProjection() {
    return this.request('/projection', { method: 'GET' });
  }

  async updateProjectionSettings(settings) {
    return this.request('/projection/settings', { method: 'PUT', body: JSON.stringify(settings) });
  }

  async saveProjectionCell(cell) {
    return this.request('/projection/overrides', { method: 'PUT', body: JSON.stringify(cell) });
  }

  async resetProjection() {
    return this.request('/projection/overrides', { method: 'DELETE' });
  }

  async getAccounts() {
    return this.request('/accounts', { method: 'GET' });
  }

  async createAccount(accountData) {
    return this.request('/accounts', {
      method: 'POST',
      body: JSON.stringify(accountData)
    });
  }

  async updateAccount(id, accountData) {
    return this.request(`/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(accountData)
    });
  }

  async deleteAccount(id) {
    return this.request(`/accounts/${id}`, { method: 'DELETE' });
  }

  async getCategories() {
    return this.request('/categories', { method: 'GET' });
  }

  async createCategory(categoryData) {
    return this.request('/categories', {
      method: 'POST',
      body: JSON.stringify(categoryData)
    });
  }

  async updateCategory(id, categoryData) {
    return this.request(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(categoryData)
    });
  }

  async deleteCategory(id) {
    return this.request(`/categories/${id}`, { method: 'DELETE' });
  }

  async createSupraCategory(supraData) {
    return this.request('/supra-categories', {
      method: 'POST',
      body: JSON.stringify(supraData)
    });
  }

  async updateSupraCategory(id, supraData) {
    return this.request(`/supra-categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(supraData)
    });
  }

  async getCategoryRules() {
    return this.request('/category-rules', { method: 'GET' });
  }

  async updateCategoryRule(id, ruleData) {
    return this.request(`/category-rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(ruleData)
    });
  }

  async deleteCategoryRule(id) {
    return this.request(`/category-rules/${id}`, { method: 'DELETE' });
  }

  async getTransactions(accountId) {
    return this.request(`/accounts/${accountId}/transactions`, { method: 'GET' });
  }

  async createTransaction(accountId, txData) {
    return this.request(`/accounts/${accountId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(txData)
    });
  }

  async importTransactions(accountId, rows) {
    return this.request(`/accounts/${accountId}/transactions/import`, {
      method: 'POST',
      body: JSON.stringify({ rows })
    });
  }

  async updateTransactionCategory(accountId, transactionId, data) {
    return this.request(`/accounts/${accountId}/transactions/${transactionId}/category`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteTransaction(accountId, transactionId) {
    return this.request(`/accounts/${accountId}/transactions/${transactionId}`, { method: 'DELETE' });
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Error during logout API call', e);
    } finally {
      this.setToken(null);
    }
  }
}

export const api = new ApiService();
