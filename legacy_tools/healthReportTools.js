const Conversation = require('../models/Conversation');
const { saveWithRetry } = require('../utils/dbUtils');

async function addFunctionCallToMessage(conversationId, functionName, args) {
  // TODO: Modify to manage multiple platforms. 
  console.log(`Adding function call ${functionName} to message ${args.referenced_message} for conversation ${conversationId}`);
  console.log('args', args);
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    console.error('Conversation not found:', conversationId);
    return;
  }

  const referencedMessage = conversation.messages.find(msg => msg.msg_foreign_id === args.referenced_message);

  if (referencedMessage) {
    if (!referencedMessage.functionCalls) {
      referencedMessage.functionCalls = [];
    }
    referencedMessage.functionCalls.push({
      type: 'function',
      name: functionName,
      parameters: args
    });
    await conversation.save();
    console.log(`Function call ${functionName} added to referenced message for conversation ${conversationId}`);
  } else {
    console.error('Referenced message not found in conversation:', conversationId);
  }
}

async function addUpdateToPreviousReport(messageId, reportId, update, update_id, conversationId) {
  console.log('Adding update to previous report:', update, 'for message:', messageId, 'and report:', reportId);
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    console.error('Conversation not found:', conversationId);
    return "Error: Conversation not found. Please continue the conversation.";
  }

  const messageIndex = conversation.messages.findIndex(msg => msg.ultraMsgData?.id.toString() === messageId);
  if (messageIndex === -1) {
    console.error('Message not found:', messageId);
    return "Error: Message not found. Please continue the conversation.";
  }

  const functionCallIndex = conversation.messages[messageIndex].functionCalls?.findIndex(call => call.parameters.id === reportId);
  if (functionCallIndex === -1) {
    console.error('Function call not found for report:', reportId);
    return "Error: Function call not found for report. Please continue the conversation.";
  }

  const newUpdate = {
    timestamp: new Date().toISOString(),
    update: update,
    update_id: update_id
  };

  if (!conversation.messages[messageIndex].functionCalls[functionCallIndex].updates) {
    conversation.messages[messageIndex].functionCalls[functionCallIndex].updates = [newUpdate];
  } else {
    conversation.messages[messageIndex].functionCalls[functionCallIndex].updates.push(newUpdate);
  }

  try {
    await saveWithRetry(conversation);
    console.log('Update added successfully to report:', reportId);
    return "Update added successfully to report " + reportId + " related to message " + messageId + ".";
  } catch (error) {
    console.error('Error saving conversation:', error);
    return "Error: Failed to save the update. Please try again.";
  }
}

async function handleMedicationIntake(args, conversationId) {
  console.log('Handling medication intake:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'report_medication_intake', args);
  // TODO: Implement additional medication intake logic if needed
  return { status: 'done', report_id: args.id, referenced_message_id: args.referenced_message, args: args };
}

async function handleBloodPressureMeasurement(args, conversationId) {
  console.log('Handling blood pressure measurement:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'report_blood_pressure_measurement', args);
  // TODO: Implement additional blood pressure measurement logic if needed
  return { status: 'done', report_id: args.id, referenced_message_id: args.referenced_message, args: args };
}

async function handleAdverseEvent(args, conversationId) {
  console.log('Handling adverse event:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'report_adverse_event', args);
  // TODO: Implement additional adverse event logic if needed
  // TODO: Send Emails to client. 
  return { status: 'done', report_id: args.id, referenced_message_id: args.referenced_message, args: args };
}

async function updatePreviousReport(args, conversationId) {
  console.log('Updating previous report:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'update_previous_report', args);
  await addUpdateToPreviousReport(args.message_id, args.report_id, args.update_description, args.id, conversationId);
  
  return { status: 'done', report_id: args.report_id, message_id: args.message_id, args: args };
}

const {
  handleSearchPatient,
  handleCodeVerification,
  handleRegisterPatient,
  handleRegisterAssistanceRequest,
  handleSearchAppointments,
  handleGetAppointments,
  handleCreateAppointment,
  handleCancelAppointment,
  handlePatientInfoUpdate
} = require('./patientManagementTools');

module.exports = {
  handleMedicationIntake,
  handleBloodPressureMeasurement,
  handleAdverseEvent,
  updatePreviousReport,
  handleSearchPatient,
  handleCodeVerification,
  handleRegisterPatient,
  handleRegisterAssistanceRequest,
  handleSearchAppointments,
  handleGetAppointments,
  handleCreateAppointment,
  handleCancelAppointment,
  handlePatientInfoUpdate
};
