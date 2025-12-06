/**
 * Assesses the condition based on the current value and thresholds
 * @param {number} currentValue - The current value from the graph
 * @param {Object} thresholds - Object containing threshold values
 * @returns {Object} Assessment object with status and message
 */
export function assessCondition(currentValue, thresholds) {
  const {
    criticoPut = 70500000,
    alertaPut = 68500000,
    alertaCall = 66500000,
    criticoCall = 64000000
  } = thresholds;

  let status;
  let message;
  let severity;

  if (currentValue >= criticoPut) {
    status = 'Crítico PUT';
    message = `Valor crítico PUT: ${currentValue.toLocaleString('pt-BR')}`;
    severity = 'critical';
  } else if (currentValue >= alertaPut) {
    status = 'Alerta PUT';
    message = `Alerta PUT: ${currentValue.toLocaleString('pt-BR')}`;
    severity = 'warning';
  } else if (currentValue > alertaCall && currentValue < alertaPut) {
    status = 'Neutro';
    message = `Valor neutro: ${currentValue.toLocaleString('pt-BR')}`;
    severity = 'neutral';
  } else if (currentValue >= criticoCall && currentValue <= alertaCall) {
    status = 'Alerta CALL';
    message = `Alerta CALL: ${currentValue.toLocaleString('pt-BR')}`;
    severity = 'warning';
  } else {
    status = 'Crítico CALL';
    message = `Valor crítico CALL: ${currentValue.toLocaleString('pt-BR')}`;
    severity = 'critical';
  }

  return {
    status,
    message,
    severity,
    currentValue
  };
}

