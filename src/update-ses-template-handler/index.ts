import {
  SESClient,
  UpdateTemplateCommand,
  GetTemplateCommand,
} from "@aws-sdk/client-ses";
import axios from "axios";

const sesClient = new SESClient({ region: "us-east-1" });

export async function handler(event: any, context: any, callback: any) {
  event.Records.forEach(async (record: any) => {
    const path = record.s3.object.key;
    const templateName = path.slice(
      path.lastIndexOf("/") + 1,
      path.lastIndexOf(".")
    );

    await sesClient
      .send(new GetTemplateCommand({ TemplateName: templateName }))
      .then(async (data: any) => {
        const htmlData = await axios
          .get(
            `https://assets.communications.dev.euler.tools/euler-tools-emails/html/${data.Template.TemplateName}.html`
          )
          .then((res) => {
            return res.data;
          });
        await sesClient
          .send(
            new UpdateTemplateCommand({
              Template: {
                TemplateName: data.Template.TemplateName,
                HtmlPart: htmlData,
                SubjectPart: data.Template.SubjectPart,
              },
            })
          )
          .then(() => {
            console.log("Template Updated...");
          });
      });
  });
}
