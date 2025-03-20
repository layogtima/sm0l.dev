// Cloudflare Worker script to handle form submissions and send emails using Resend
// Save this as index.js in your Worker project

export default {
  async fetch(request, env, ctx) {
    // Handle CORS for preflight requests
    if (request.method === "OPTIONS") {
      return handleCORS(env);
    }

    // Only allow POST requests for form submissions
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      // Parse the JSON body from the request
      let formData;
      try {
        formData = await request.json();
      } catch (parseError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid JSON in request body",
            details: parseError.message,
          }),
          {
            status: 400,
            headers: corsHeaders(env),
          }
        );
      }

      // Check for required fields and collect missing fields
      const requiredFields = ["email", "idea"];
      const missingFields = requiredFields.filter((field) => !formData[field]);

      if (missingFields.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Missing required fields",
            missingFields: missingFields,
          }),
          {
            status: 400,
            headers: corsHeaders(env),
          }
        );
      }

      // Get the list of recipients from environment variables
      const recipients = getRecipientsList(env);

      if (recipients.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Server configuration error",
            details: "No recipient emails configured",
          }),
          {
            status: 500,
            headers: corsHeaders(env),
          }
        );
      }

      // Validate Maileroo API key existence
      if (!env.MAILEROO_API_KEY) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Server configuration error",
            details: "Email service not properly configured",
          }),
          {
            status: 500,
            headers: corsHeaders(env),
          }
        );
      }

      // Format sender information
      const fromEmail = env.EMAIL_FROM || "no-reply@example.com";
      const fromAddress = fromEmail;

      // Format the email content
      const emailSubject = "New Project Inquiry on sm0l.dev ";
      const emailText = formatEmailContent(formData);
      const emailHtml = formatEmailHtml(formData);

      // Send email via Maileroo to all recipients
      let emailResponse;
      let emailResponseData;
      let referenceId;

      try {
        // Add any extra configuration from env variables
        const replyTo = env.EMAIL_REPLY_TO || null;
        const enableTracking = env.EMAIL_TRACKING === "yes" ? true : undefined;

        emailResponse = await sendEmailWithMaileroo(env.MAILEROO_API_KEY, {
          from: fromAddress,
          to: recipients,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
          replyTo: replyTo,
          tracking: enableTracking,
        });

        // Try to parse the response as JSON
        try {
          emailResponseData = await emailResponse.json();
        } catch (e) {
          // If not JSON, get as text
          emailResponseData = await emailResponse.text();
        }

        if (!emailResponse.ok) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Failed to send email",
              statusCode: emailResponse.status,
              details: emailResponseData,
            }),
            {
              status: 500,
              headers: corsHeaders(env),
            }
          );
        }
      } catch (sendError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Email service error",
            details: sendError.message,
          }),
          {
            status: 500,
            headers: corsHeaders(env),
          }
        );
      }

      // Return detailed success response
      return new Response(
        JSON.stringify({
          success: true,
          message: "Form submitted successfully",
          recipients: recipients.length,
          emailId: emailResponseData?.id || null,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: corsHeaders(env),
        }
      );
    } catch (error) {
      // Log the error for debugging
      console.error("Error processing form:", error);

      // Determine if this is a known error type or unexpected
      let statusCode = 500;
      let errorMessage = "Failed to process form submission";
      let errorDetails = error.message || "Unknown error";

      // Map common errors to appropriate status codes
      if (error.name === "SyntaxError") {
        statusCode = 400;
        errorMessage = "Invalid request format";
      } else if (error.message && error.message.includes("fetch")) {
        errorMessage = "Email service communication error";
      }

      // Return detailed error response
      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          details: errorDetails,
          timestamp: new Date().toISOString(),
          errorType: error.name || "Error",
        }),
        {
          status: statusCode,
          headers: corsHeaders(env),
        }
      );
    }
  },
};

// Get recipients list from environment variable
function getRecipientsList(env) {
  if (!env.EMAIL_RECIPIENTS) {
    return [];
  }

  // Split comma-separated list of emails and trim whitespace
  return env.EMAIL_RECIPIENTS.split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

// Format the form data into a readable plain text email
function formatEmailContent(formData) {
  return `
${formData.idea}

Client Email: ${formData.email}
Timeline: ${formData.timeline || "Not specified"}
Budget: ${formData.budget || "Not specified"}
Submitted: ${formData.timestamp || new Date().toISOString()}
`;
}

// Format the form data into HTML email
function formatEmailHtml(formData) {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { color: #2c3e50; margin-bottom: 20px; }
    .form-item { margin-bottom: 15px; }
    .label { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>New Project Inquiry</h1>
    <div class="form-item">
      <span class="label">Email:</span> ${formData.email}
    </div>
    <div class="form-item">
      <span class="label">Project Idea:</span> ${formData.idea}
    </div>
    <div class="form-item">
      <span class="label">Timeline:</span> ${
        formData.timeline || "Not specified"
      }
    </div>
    <div class="form-item">
      <span class="label">Budget:</span> ${formData.budget || "Not specified"}
    </div>
    <div class="form-item">
      <span class="label">Submitted:</span> ${
        formData.timestamp || new Date().toISOString()
      }
    </div>
  </div>
</body>
</html>
`;
}

// Send an email using Maileroo API
async function sendEmailWithMaileroo(apiKey, emailData) {
  // Create form data for multipart/form-data request
  const formData = new FormData();

  // Add required fields
  formData.append("from", emailData.from);
  formData.append(
    "to",
    Array.isArray(emailData.to) ? emailData.to.join(",") : emailData.to
  );
  formData.append("subject", emailData.subject);

  // Add email body formats
  if (emailData.html) {
    formData.append("html", emailData.html);
  }
  if (emailData.text) {
    formData.append("plain", emailData.text);
  }

  // Add optional fields if provided
  if (emailData.replyTo) {
    formData.append("reply_to", emailData.replyTo);
  }

  // Add tracking if specified
  if (emailData.tracking !== undefined) {
    formData.append("tracking", emailData.tracking ? "yes" : "no");
  }

  // Generate a reference ID (can be used for tracking)
  const referenceId = generateReferenceId();
  formData.append("reference_id", referenceId);

  // Make the request to Maileroo API
  return fetch("https://smtp.maileroo.com/send", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: formData,
  });
}

// Generate a 24-character hexadecimal reference ID
function generateReferenceId() {
  const characters = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Handle CORS for preflight requests
function handleCORS(env) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(env),
  });
}

// Set CORS headers
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };
}
