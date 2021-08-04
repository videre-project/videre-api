import { TEMPLATES } from 'constants.js'

export default (req, res) => {
    res.status(200).json({
        ...TEMPLATES.BAD_REQUEST,
        "details": "No data is returned at this path. For more information about this API's published methods and objects, see https://videreproject.com/docs/api."
    })
}