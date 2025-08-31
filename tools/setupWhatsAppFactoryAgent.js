/**
 * setupWhatsAppFactoryAgent.js
 * 
 * Description: Script para configurar automáticamente un agente para WhatsApp Factory
 * 
 * Role in the system: Herramienta de configuración para facilitar la integración con WhatsApp Factory
 * 
 * Node.js Context: Tool - script de configuración
 * 
 * Dependencies:
 * - ../models (Agent, Client)
 * - ../db (database connection)
 * 
 * Usage: node tools/setupWhatsAppFactoryAgent.js
 */

const { Agent, Client } = require('../models');
const { sequelize } = require('../database');

async function setupWhatsAppFactoryAgent() {
  try {
    console.log('🔧 Configurando agente para WhatsApp Factory...\n');

    // Verificar conexión a la base de datos
    await sequelize.authenticate();
    console.log('✅ Conexión a la base de datos establecida');

    // Buscar o crear un cliente por defecto
    let client = await Client.findOne({ where: { deletedAt: null } });
    if (!client) {
      console.log('📝 Creando cliente por defecto...');
      client = await Client.create({
        name: 'Cliente WhatsApp Factory',
        email: 'whatsapp-factory@example.com'
      });
      console.log('✅ Cliente creado con ID:', client.id);
    } else {
      console.log('✅ Cliente existente encontrado:', client.name);
    }

    // Verificar si ya existe un agente para WhatsApp Factory
    const existingAgent = await Agent.findOne({
      where: {
        type: 'wpp-bsp',
        instanceId: '559995607197034', // El instanceId del log
        deletedAt: null
      }
    });

    if (existingAgent) {
      console.log('✅ Agente para WhatsApp Factory ya existe:');
      console.log('   ID:', existingAgent.id);
      console.log('   Nombre:', existingAgent.name);
      console.log('   InstanceId:', existingAgent.instanceId);
      console.log('   Estado:', existingAgent.status);
      console.log('   Tipo:', existingAgent.type);
      
      // Actualizar el estado si es necesario
      if (existingAgent.status !== 'Active') {
        await existingAgent.update({ status: 'Active' });
        console.log('✅ Estado actualizado a Active');
      }
      
      return existingAgent;
    }

    // Crear nuevo agente para WhatsApp Factory
    console.log('📝 Creando nuevo agente para WhatsApp Factory...');
    const newAgent = await Agent.create({
      name: 'WhatsApp Business API Agent',
      type: 'wpp-bsp', // Nuevo tipo para WhatsApp Business API
      instanceId: '559995607197034', // El instanceId del log (phoneNumberId)
      status: 'Active',
      clientId: client.id,
      notificationEmail: 'admin@example.com',
      // token: Se configurará manualmente con la API Key de WhatsApp Business API
      // assistantId: No aplica para wpp-bsp, se usa OpenAI directamente
    });

    console.log('✅ Agente creado exitosamente:');
    console.log('   ID:', newAgent.id);
    console.log('   Nombre:', newAgent.name);
    console.log('   InstanceId:', newAgent.instanceId);
    console.log('   Estado:', newAgent.status);
    console.log('   Tipo:', newAgent.type);
    console.log('   Cliente ID:', newAgent.clientId);

    console.log('\n📋 Próximos pasos:');
    console.log('   1. Configurar token con la API Key de WhatsApp Business API');
    console.log('   2. Verificar que el webhook esté configurado correctamente');
    console.log('   3. Configurar OpenAI Assistant ID si se requiere AI');
    console.log('   4. Probar el envío de un mensaje');
    console.log('\n📝 Notas importantes:');
    console.log('   - Tipo de agente: wpp-bsp (WhatsApp Business API)');
    console.log('   - instanceId: Referencia al número de WhatsApp (phoneNumberId)');
    console.log('   - token: API Key de WhatsApp Business API');
    console.log('   - assistantId: No aplica para wpp-bsp (se usa OpenAI directamente)');

    return newAgent;

  } catch (error) {
    console.error('❌ Error configurando agente:', error.message);
    throw error;
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  setupWhatsAppFactoryAgent()
    .then(() => {
      console.log('\n🎉 Configuración completada exitosamente!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Error en la configuración:', error.message);
      process.exit(1);
    });
}

module.exports = { setupWhatsAppFactoryAgent };
